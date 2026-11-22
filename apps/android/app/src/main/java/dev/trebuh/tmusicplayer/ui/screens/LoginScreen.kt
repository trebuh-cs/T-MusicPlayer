package dev.trebuh.tmusicplayer.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trebuh.tmusicplayer.R
import dev.trebuh.tmusicplayer.data.api.ServerHealthResponse
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors

@Composable
fun LoginScreen(
    initialServerUrl: String,
    isLoading: Boolean,
    error: String?,
    healthStatus: ServerHealthResponse?,
    onTestServer: (String) -> Unit,
    onLogin: (serverUrl: String, username: String, password: String) -> Unit,
    onRegister: (serverUrl: String, username: String, password: String, inviteCode: String?) -> Unit,
    onClearError: () -> Unit,
) {
    val palette = LocalTMusicColors.current
    var serverUrl by rememberSaveable { mutableStateOf(initialServerUrl) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var inviteCode by rememberSaveable { mutableStateOf("") }
    var isRegisterMode by rememberSaveable { mutableStateOf(false) }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = palette.accent,
        unfocusedBorderColor = palette.borderSubtle,
        focusedTextColor = palette.textPrimary,
        unfocusedTextColor = palette.textPrimary,
        focusedLabelColor = palette.accent,
        unfocusedLabelColor = palette.textSecondary,
        cursorColor = palette.accent,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(palette.bgSurface)
                .border(1.dp, palette.borderSubtle, RoundedCornerShape(18.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_tpx_logo),
                contentDescription = "T-MusicPlayer",
                modifier = Modifier.size(48.dp),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "T - MusicPlayer",
            color = palette.textPrimary,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Connect via Cloudflare Tunnel or local LAN",
            color = palette.textSecondary,
            fontSize = 13.sp,
        )

        Spacer(modifier = Modifier.height(24.dp))

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(palette.bgElevated)
                .border(1.dp, palette.borderSubtle, RoundedCornerShape(16.dp))
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = serverUrl,
                onValueChange = {
                    serverUrl = it
                    onClearError()
                },
                label = { Text("Home Server URL") },
                placeholder = { Text("https://music.yourdomain.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                OutlinedButton(
                    onClick = { onTestServer(serverUrl) },
                    enabled = !isLoading && serverUrl.isNotBlank(),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.CloudDone,
                        contentDescription = null,
                        tint = palette.accent,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.size(6.dp))
                    Text("Test Server", color = palette.textPrimary, fontSize = 12.sp)
                }

                if (healthStatus != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Check,
                            contentDescription = null,
                            tint = palette.accent,
                            modifier = Modifier.size(15.dp),
                        )
                        Text(
                            text = "v${healthStatus.version} online",
                            color = palette.accent,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }

            // Mode toggle: Sign In / Create Account
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(palette.bgSurface)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf(false to "Sign In", true to "Create Account").forEach { (reg, label) ->
                    val selected = isRegisterMode == reg
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) palette.accent else palette.bgSurface)
                            .clickable {
                                isRegisterMode = reg
                                onClearError()
                            }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = label,
                            color = if (selected) palette.accentContrast else palette.textSecondary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            OutlinedTextField(
                value = username,
                onValueChange = {
                    username = it
                    onClearError()
                },
                label = { Text("Username") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = password,
                onValueChange = {
                    password = it
                    onClearError()
                },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = if (isRegisterMode) ImeAction.Next else ImeAction.Done,
                ),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth(),
            )

            if (isRegisterMode) {
                OutlinedTextField(
                    value = inviteCode,
                    onValueChange = { inviteCode = it },
                    label = {
                        Text(
                            if (healthStatus?.inviteRequired == true) {
                                "Invite Code (required)"
                            } else {
                                "Invite Code (optional)"
                            }
                        )
                    },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (!error.isNullOrBlank()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(palette.bgSurface)
                        .border(1.dp, androidx.compose.ui.graphics.Color(0xFFEF4444), RoundedCornerShape(8.dp))
                        .padding(10.dp),
                ) {
                    Text(
                        text = error,
                        color = androidx.compose.ui.graphics.Color(0xFFFCA5A5),
                        fontSize = 12.sp,
                    )
                }
            }

            Button(
                onClick = {
                    if (isRegisterMode) {
                        onRegister(serverUrl, username, password, inviteCode)
                    } else {
                        onLogin(serverUrl, username, password)
                    }
                },
                enabled = !isLoading && serverUrl.isNotBlank() && username.isNotBlank() && password.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = palette.accent,
                    contentColor = palette.accentContrast,
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        color = palette.accentContrast,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Text(
                        text = if (isRegisterMode) "Create Account & Sync" else "Connect & Sync Library",
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}
