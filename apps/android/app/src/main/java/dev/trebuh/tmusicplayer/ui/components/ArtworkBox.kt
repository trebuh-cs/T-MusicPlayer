package dev.trebuh.tmusicplayer.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import dev.trebuh.tmusicplayer.R
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors

@Composable
fun ArtworkBox(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    cornerRadius: Dp = 8.dp,
) {
    val palette = LocalTMusicColors.current
    val shape = RoundedCornerShape(cornerRadius)

    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(palette.bgSurface)
            .border(1.dp, palette.borderSubtle, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (model == null) {
            FallbackArtwork(isTpx = palette.id == "tpx", iconSize = size * 0.5f)
        } else {
            SubcomposeAsyncImage(
                model = model,
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = {
                    FallbackArtwork(isTpx = palette.id == "tpx", iconSize = size * 0.45f)
                },
                error = {
                    FallbackArtwork(isTpx = palette.id == "tpx", iconSize = size * 0.5f)
                },
            )
        }
    }
}

@Composable
private fun FallbackArtwork(isTpx: Boolean, iconSize: Dp) {
    val palette = LocalTMusicColors.current
    if (isTpx) {
        Image(
            painter = painterResource(id = R.drawable.ic_tpx_logo),
            contentDescription = "TPX",
            modifier = Modifier
                .size(iconSize)
                .padding(2.dp),
        )
    } else {
        Icon(
            imageVector = Icons.Rounded.MusicNote,
            contentDescription = null,
            tint = palette.accent,
            modifier = Modifier.size(iconSize),
        )
    }
}
