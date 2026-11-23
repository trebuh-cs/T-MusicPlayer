package dev.trebuh.tmusicplayer.data.api

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class TMusicApiClient {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val downloadClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun checkHealth(baseUrl: String): Result<ServerHealthResponse> =
        withContext(Dispatchers.IO) {
            runCatching {
                val url = "${baseUrl.trimEnd('/')}/api/v1/health"
                val request = Request.Builder().url(url).get().build()
                executeJson<ServerHealthResponse>(request)
            }
        }

    suspend fun login(
        baseUrl: String,
        username: String,
        password: String,
    ): Result<AuthResponseDto> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${baseUrl.trimEnd('/')}/api/v1/auth/login"
            val body = json.encodeToString(AuthLoginRequest(username.trim(), password))
                .toRequestBody(jsonMediaType)
            val request = Request.Builder().url(url).post(body).build()
            executeJson<AuthResponseDto>(request)
        }
    }

    suspend fun register(
        baseUrl: String,
        username: String,
        password: String,
        inviteCode: String?,
    ): Result<AuthResponseDto> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${baseUrl.trimEnd('/')}/api/v1/auth/register"
            val cleanInvite = inviteCode?.trim()?.takeIf { it.isNotEmpty() }
            val body = json.encodeToString(
                AuthRegisterRequest(username.trim(), password, cleanInvite)
            ).toRequestBody(jsonMediaType)
            val request = Request.Builder().url(url).post(body).build()
            executeJson<AuthResponseDto>(request)
        }
    }

    suspend fun pullSync(baseUrl: String, token: String): Result<SyncPullResponseDto> =
        withContext(Dispatchers.IO) {
            runCatching {
                val url = "${baseUrl.trimEnd('/')}/api/v1/sync/pull"
                val request = Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $token")
                    .get()
                    .build()
                executeJson<SyncPullResponseDto>(request)
            }
        }

    suspend fun pushSync(
        baseUrl: String,
        token: String,
        payload: SyncPushRequestDto,
    ): Result<SyncPushResponseDto> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${baseUrl.trimEnd('/')}/api/v1/sync/push"
            val body = json.encodeToString(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .post(body)
                .build()
            executeJson<SyncPushResponseDto>(request)
        }
    }

    suspend fun downloadToFile(
        url: String,
        destFile: File,
        authToken: String? = null,
        onProgress: ((downloadedBytes: Long, totalBytes: Long) -> Unit)? = null,
    ): Result<Long> = withContext(Dispatchers.IO) {
        runCatching {
            destFile.parentFile?.mkdirs()
            val tmpFile = File(destFile.parentFile, "${destFile.name}.part")
            val builder = Request.Builder().url(url).get()
            if (!authToken.isNullOrBlank()) {
                builder.header("Authorization", "Bearer $authToken")
            }
            downloadClient.newCall(builder.build()).execute().use { response ->
                if (!response.isSuccessful) {
                    val errText = response.body?.string().orEmpty()
                    throw IOException(extractErrorMessage(response.code, errText))
                }
                val body = response.body ?: throw IOException("Empty download body")
                val total = body.contentLength()
                var copied = 0L
                body.byteStream().use { input ->
                    tmpFile.outputStream().use { output ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            copied += read
                            onProgress?.invoke(copied, total)
                        }
                    }
                }
                if (destFile.exists()) {
                    destFile.delete()
                }
                if (!tmpFile.renameTo(destFile)) {
                    tmpFile.copyTo(destFile, overwrite = true)
                    tmpFile.delete()
                }
                copied
            }
        }
    }

    fun buildStreamUrl(
        baseUrl: String,
        token: String,
        trackId: String,
        quality: String = "best",
        download: Boolean = false,
    ): String {
        val parsed = "${baseUrl.trimEnd('/')}/api/v1/stream/$trackId".toHttpUrlOrNull()
            ?: return "${baseUrl.trimEnd('/')}/api/v1/stream/$trackId"
        val builder = parsed.newBuilder()
            .addQueryParameter("token", token)
        if (quality == "saver") {
            builder.addQueryParameter("quality", "saver")
        }
        if (download) {
            builder.addQueryParameter("download", "1")
        }
        return builder.build().toString()
    }

    fun buildCoverUrl(baseUrl: String, coverHash: String): String =
        "${baseUrl.trimEnd('/')}/api/v1/covers/$coverHash"

    suspend fun uploadAudioFromUri(
        context: Context,
        baseUrl: String,
        token: String,
        uri: Uri,
        onProgress: (String) -> Unit,
    ): Result<ServerTrackDto> = withContext(Dispatchers.IO) {
        runCatching {
            val resolver = context.contentResolver
            var displayName = "track.mp3"
            var totalSize = -1L
            resolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) {
                        cursor.getString(nameIdx)?.takeIf { it.isNotBlank() }?.let {
                            displayName = it
                        }
                    }
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        totalSize = cursor.getLong(sizeIdx)
                    }
                }
            }

            onProgress("Hashing $displayName…")
            val digest = MessageDigest.getInstance("SHA-256")
            var countedBytes = 0L
            resolver.openInputStream(uri)?.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buf)
                    if (read == -1) break
                    digest.update(buf, 0, read)
                    countedBytes += read
                }
            } ?: throw IOException("Could not open selected file: $displayName")

            val actualSize = if (countedBytes > 0L) countedBytes else totalSize.coerceAtLeast(0L)
            if (actualSize <= 0L) {
                throw IOException("Selected audio file is empty: $displayName")
            }
            val contentHash = digest.digest().joinToString("") { "%02x".format(it) }
            val stemTitle = displayName.substringBeforeLast('.').ifBlank { displayName }

            val cleanBase = baseUrl.trimEnd('/')
            val initBody = json.encodeToString(
                UploadInitRequestDto(
                    contentHash = contentHash,
                    filename = displayName,
                    totalSize = actualSize,
                    title = stemTitle,
                    artist = "Unknown Artist",
                    album = "Uploads",
                )
            ).toRequestBody(jsonMediaType)
            val initReq = Request.Builder()
                .url("$cleanBase/api/v1/tracks/upload/init")
                .header("Authorization", "Bearer $token")
                .post(initBody)
                .build()
            val initResp = executeJson<UploadInitResponseDto>(initReq)
            if (initResp.status == "exists" && initResp.track != null) {
                return@runCatching initResp.track
            }
            val uploadId = initResp.uploadId
                ?: throw IOException("Server did not return an upload session ID")
            val chunkSize = initResp.chunkSize.coerceIn(512 * 1024, 16 * 1024 * 1024)
            val octetType = "application/octet-stream".toMediaType()

            resolver.openInputStream(uri)?.use { input ->
                val chunkBuf = ByteArray(chunkSize)
                var offset = 0L
                while (true) {
                    var filled = 0
                    while (filled < chunkSize) {
                        val r = input.read(chunkBuf, filled, chunkSize - filled)
                        if (r == -1) break
                        filled += r
                    }
                    if (filled <= 0) break

                    val pct = ((offset + filled) * 100L / actualSize).toInt().coerceIn(0, 99)
                    onProgress("Uploading $displayName ($pct%)")

                    val chunkReq = Request.Builder()
                        .url("$cleanBase/api/v1/tracks/upload/$uploadId/chunk?offset=$offset")
                        .header("Authorization", "Bearer $token")
                        .post(chunkBuf.toRequestBody(octetType, 0, filled))
                        .build()
                    downloadClient.newCall(chunkReq).execute().use { resp ->
                        if (!resp.isSuccessful) {
                            val errBody = resp.body?.string().orEmpty()
                            throw IOException(extractErrorMessage(resp.code, errBody))
                        }
                    }
                    offset += filled
                }
            } ?: throw IOException("Could not re-open file for upload: $displayName")

            onProgress("Finalizing $displayName…")
            val completeReq = Request.Builder()
                .url("$cleanBase/api/v1/tracks/upload/$uploadId/complete")
                .header("Authorization", "Bearer $token")
                .post(ByteArray(0).toRequestBody(null))
                .build()
            executeJson<ServerTrackDto>(completeReq)
        }
    }

    private inline fun <reified T> executeJson(request: Request): T {
        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException(extractErrorMessage(response.code, raw))
            }
            return json.decodeFromString<T>(raw)
        }
    }

    private fun extractErrorMessage(code: Int, rawBody: String): String {
        val parsed = runCatching { json.decodeFromString<ApiErrorDto>(rawBody).error }.getOrNull()
        val msg = parsed?.takeIf { it.isNotBlank() } ?: rawBody.take(180).ifBlank { "HTTP $code" }
        return "HTTP $code: $msg"
    }
}
