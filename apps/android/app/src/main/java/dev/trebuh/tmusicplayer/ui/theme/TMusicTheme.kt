package dev.trebuh.tmusicplayer.ui.theme

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.roundToInt

@Serializable
data class ThemeColorsRaw(
    val bgBase: String,
    val bgElevated: String,
    val bgSurface: String,
    val bgHover: String,
    val borderSubtle: String,
    val textPrimary: String,
    val textSecondary: String,
    val textMuted: String,
    val accent: String,
    val accentContrast: String,
    val accentSoft: String,
    val vizStart: String,
    val vizEnd: String,
)

@Serializable
data class ThemeDefinition(
    val id: String,
    val name: String,
    val description: String = "",
    val mode: String = "dark",
    val colors: ThemeColorsRaw,
)

data class TMusicColors(
    val id: String,
    val isDark: Boolean,
    val bgBase: Color,
    val bgElevated: Color,
    val bgSurface: Color,
    val bgHover: Color,
    val borderSubtle: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val accent: Color,
    val accentContrast: Color,
    val accentSoft: Color,
    val vizStart: Color,
    val vizEnd: Color,
) {
    companion object {
        val FallbackTpx = TMusicColors(
            id = "tpx",
            isDark = true,
            bgBase = Color(0xFF090A09),
            bgElevated = Color(0xFF111311),
            bgSurface = Color(0xFF181B18),
            bgHover = Color(0xFF212621),
            borderSubtle = Color(0x240AF92A),
            textPrimary = Color(0xFFF2F5F2),
            textSecondary = Color(0xFFA0B0A2),
            textMuted = Color(0xFF5E6E60),
            accent = Color(0xFF0AF92A),
            accentContrast = Color(0xFF061108),
            accentSoft = Color(0x240AF92A),
            vizStart = Color(0xFF0AF92A),
            vizEnd = Color(0xFF49ECC1),
        )
    }
}

val LocalTMusicColors = staticCompositionLocalOf { TMusicColors.FallbackTpx }

object ThemeRegistry {
    private val json = Json { ignoreUnknownKeys = true }

    fun loadThemes(context: Context): List<ThemeDefinition> {
        val raw = runCatching {
            context.assets.open("themes.json").bufferedReader().use { it.readText() }
        }.getOrNull() ?: return defaultFallbackDefinitions()

        return runCatching {
            json.decodeFromString<List<ThemeDefinition>>(raw)
        }.getOrElse { defaultFallbackDefinitions() }
    }

    fun toPalette(def: ThemeDefinition): TMusicColors {
        val c = def.colors
        return TMusicColors(
            id = def.id,
            isDark = def.mode != "light",
            bgBase = Color(parseCssColorToArgb(c.bgBase)),
            bgElevated = Color(parseCssColorToArgb(c.bgElevated)),
            bgSurface = Color(parseCssColorToArgb(c.bgSurface)),
            bgHover = Color(parseCssColorToArgb(c.bgHover)),
            borderSubtle = Color(parseCssColorToArgb(c.borderSubtle)),
            textPrimary = Color(parseCssColorToArgb(c.textPrimary)),
            textSecondary = Color(parseCssColorToArgb(c.textSecondary)),
            textMuted = Color(parseCssColorToArgb(c.textMuted)),
            accent = Color(parseCssColorToArgb(c.accent)),
            accentContrast = Color(parseCssColorToArgb(c.accentContrast)),
            accentSoft = Color(parseCssColorToArgb(c.accentSoft)),
            vizStart = Color(parseCssColorToArgb(c.vizStart)),
            vizEnd = Color(parseCssColorToArgb(c.vizEnd)),
        )
    }

    /** Parses `#RRGGBB`, `#AARRGGBB`, `rgb(r,g,b)`, and `rgba(r,g,b,a)` into a 32-bit ARGB int. */
    fun parseCssColorToArgb(spec: String): Int {
        val s = spec.trim()
        if (s.startsWith("#")) {
            val hex = s.substring(1)
            return when (hex.length) {
                6 -> (0xFF000000L or hex.toLong(16)).toInt()
                8 -> hex.toLong(16).toInt()
                else -> 0xFF0AF92A.toInt()
            }
        }
        val lower = s.lowercase()
        if (lower.startsWith("rgba(") || lower.startsWith("rgb(")) {
            val inner = s.substringAfter("(").substringBeforeLast(")")
            val parts = inner.split(",").map { it.trim() }
            if (parts.size >= 3) {
                val r = parts[0].toIntOrNull()?.coerceIn(0, 255) ?: 0
                val g = parts[1].toIntOrNull()?.coerceIn(0, 255) ?: 0
                val b = parts[2].toIntOrNull()?.coerceIn(0, 255) ?: 0
                val a = if (parts.size >= 4) {
                    val alphaFloat = parts[3].toFloatOrNull() ?: 1f
                    (alphaFloat.coerceIn(0f, 1f) * 255f).roundToInt()
                } else {
                    255
                }
                return (a shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return 0xFF181B18.toInt()
    }

    private fun defaultFallbackDefinitions(): List<ThemeDefinition> = listOf(
        ThemeDefinition(
            id = "tpx",
            name = "TPX Matte",
            description = "Matte carbon black chassis with electric TPX neon green accents",
            mode = "dark",
            colors = ThemeColorsRaw(
                bgBase = "#090A09",
                bgElevated = "#111311",
                bgSurface = "#181B18",
                bgHover = "#212621",
                borderSubtle = "rgba(10, 249, 42, 0.14)",
                textPrimary = "#F2F5F2",
                textSecondary = "#A0B0A2",
                textMuted = "#5E6E60",
                accent = "#0AF92A",
                accentContrast = "#061108",
                accentSoft = "rgba(10, 249, 42, 0.14)",
                vizStart = "#0AF92A",
                vizEnd = "#49ECC1",
            ),
        )
    )
}

@Composable
fun TMusicTheme(
    palette: TMusicColors,
    content: @Composable () -> Unit,
) {
    val colorScheme = if (palette.isDark) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = palette.accentContrast,
            secondary = palette.vizEnd,
            onSecondary = palette.accentContrast,
            background = palette.bgBase,
            onBackground = palette.textPrimary,
            surface = palette.bgElevated,
            onSurface = palette.textPrimary,
            surfaceVariant = palette.bgSurface,
            onSurfaceVariant = palette.textSecondary,
            outline = palette.borderSubtle,
            primaryContainer = palette.accentSoft,
            onPrimaryContainer = palette.textPrimary,
        )
    } else {
        lightColorScheme(
            primary = palette.accent,
            onPrimary = palette.accentContrast,
            secondary = palette.vizEnd,
            onSecondary = palette.accentContrast,
            background = palette.bgBase,
            onBackground = palette.textPrimary,
            surface = palette.bgElevated,
            onSurface = palette.textPrimary,
            surfaceVariant = palette.bgSurface,
            onSurfaceVariant = palette.textSecondary,
            outline = palette.borderSubtle,
            primaryContainer = palette.accentSoft,
            onPrimaryContainer = palette.textPrimary,
        )
    }

    CompositionLocalProvider(LocalTMusicColors provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content,
        )
    }
}
