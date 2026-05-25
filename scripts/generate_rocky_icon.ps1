$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$brandingDir = Join-Path $root "assets\branding"
$pngPath = Join-Path $brandingDir "rockymaxx-logo.png"
$icoPath = Join-Path $brandingDir "rockymaxx.ico"
$appTargets = @(
  (Join-Path $root "apps\desktop"),
  (Join-Path $root "apps\desktop-service"),
  (Join-Path $root "apps\desktop-installer")
)

New-Item -ItemType Directory -Force -Path $brandingDir | Out-Null

$size = 1024
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$bitmap.SetResolution(144, 144)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$centerX = $size / 2
$shieldTop = 64
$shieldWidth = 560
$shieldHeight = 640
$shieldRect = New-Object System.Drawing.RectangleF(($centerX - ($shieldWidth / 2)), $shieldTop, $shieldWidth, $shieldHeight)

# Shadow
$shadowEllipse = New-Object System.Drawing.RectangleF (($centerX - 255), 615, 510, 110)
$shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$shadowPath.AddEllipse($shadowEllipse)
$shadowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $shadowPath
$shadowBrush.CenterColor = [System.Drawing.Color]::FromArgb(130, 0, 0, 0)
$shadowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$graphics.FillPath($shadowBrush, $shadowPath)
$shadowBrush.Dispose()
$shadowPath.Dispose()

function New-Color([int]$a, [int]$r, [int]$g, [int]$b) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

# Shield shape
$shieldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$left = $shieldRect.Left
$top = $shieldRect.Top
$right = $shieldRect.Right
$bottom = $shieldRect.Bottom
$middle = $shieldRect.Left + ($shieldRect.Width / 2)

$shieldPath.StartFigure()
$shieldPath.AddBezier($left + 62, $top + 38, $left + 125, $top - 5, $right - 125, $top - 5, $right - 62, $top + 38)
$shieldPath.AddLine($right - 62, $top + 38, $right - 52, $top + 250)
$shieldPath.AddBezier($right - 52, $top + 250, $right - 44, $bottom - 70, $middle + 92, $bottom - 8, $middle, $bottom + 18)
$shieldPath.AddBezier($middle, $bottom + 18, $middle - 92, $bottom - 8, $left + 44, $bottom - 70, $left + 52, $top + 250)
$shieldPath.AddLine($left + 52, $top + 250, $left + 62, $top + 38)
$shieldPath.CloseFigure()

$shieldGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
  (New-Object System.Drawing.PointF($middle, $top)),
  (New-Object System.Drawing.PointF($middle, $bottom)),
  (New-Color 255 148 148 148),
  (New-Color 255 28 28 30)
)
$blend = New-Object System.Drawing.Drawing2D.ColorBlend
$blend.Colors = @(
  (New-Color 255 40 40 44),
  (New-Color 255 162 162 162),
  (New-Color 255 82 82 88),
  (New-Color 255 18 18 22)
)
$blend.Positions = @(0.0, 0.18, 0.52, 1.0)
$shieldGradient.InterpolationColors = $blend
$graphics.FillPath($shieldGradient, $shieldPath)

$outerPen = New-Object System.Drawing.Pen((New-Color 255 232 232 232), 12)
$outerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($outerPen, $shieldPath)

$innerPath = $shieldPath.Clone()
$matrix = New-Object System.Drawing.Drawing2D.Matrix
$matrix.Scale(0.9, 0.9)
$bounds = $innerPath.GetBounds()
$matrix.Translate(($centerX - (($bounds.Left + $bounds.Right) / 2)) * 0.11, 26)
$innerPath.Transform($matrix)
$innerPen = New-Object System.Drawing.Pen((New-Color 240 206 129 70), 5)
$innerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($innerPen, $innerPath)

$highlightPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$highlightPath.AddBezier($left + 88, $top + 54, $left + 150, $top + 20, $middle - 44, $top + 10, $middle - 8, $top + 72)
$highlightPen = New-Object System.Drawing.Pen((New-Color 170 255 255 255), 18)
$highlightPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$highlightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawPath($highlightPen, $highlightPath)

# RK monogram
$metalPen = New-Object System.Drawing.Pen((New-Color 255 240 240 240), 26)
$metalPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$metalPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$metalPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen = New-Object System.Drawing.Pen((New-Color 255 194 118 56), 10)
$accentPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$darkPen = New-Object System.Drawing.Pen((New-Color 130 35 22 18), 34)
$darkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$darkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$darkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

function Draw-BeveledLine {
  param(
    [System.Drawing.PointF]$Start,
    [System.Drawing.PointF]$End
  )
  $graphics.DrawLine($darkPen, $Start, $End)
  $graphics.DrawLine($metalPen, $Start, $End)
  $graphics.DrawLine($accentPen, $Start, $End)
}

Draw-BeveledLine ([System.Drawing.PointF]::new($middle - 110, $top + 132)) ([System.Drawing.PointF]::new($middle - 110, $top + 462))
Draw-BeveledLine ([System.Drawing.PointF]::new($middle - 110, $top + 130)) ([System.Drawing.PointF]::new($middle + 36, $top + 130))
Draw-BeveledLine ([System.Drawing.PointF]::new($middle - 12, $top + 132)) ([System.Drawing.PointF]::new($middle - 12, $top + 248))
Draw-BeveledLine ([System.Drawing.PointF]::new($middle - 12, $top + 248)) ([System.Drawing.PointF]::new($middle + 104, $top + 354))
Draw-BeveledLine ([System.Drawing.PointF]::new($middle - 12, $top + 248)) ([System.Drawing.PointF]::new($middle + 98, $top + 144))

$slashHighlight = New-Object System.Drawing.Pen((New-Color 160 255 255 255), 4)
$graphics.DrawLine($slashHighlight, [System.Drawing.PointF]::new($middle + 18, $top + 142), [System.Drawing.PointF]::new($middle + 84, $top + 198))
$graphics.DrawLine($slashHighlight, [System.Drawing.PointF]::new($middle + 18, $top + 262), [System.Drawing.PointF]::new($middle + 92, $top + 332))

# Text
$textY = 760
$rockyFont = New-Object System.Drawing.Font("Arial Black", 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$maxxFont = New-Object System.Drawing.Font("Arial Black", 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$rockyText = "ROCKY"
$maxxText = "MAXX"
$rockySize = $graphics.MeasureString($rockyText, $rockyFont)
$maxxSize = $graphics.MeasureString($maxxText, $maxxFont)
$totalWidth = $rockySize.Width + $maxxSize.Width - 8
$textX = ($size - $totalWidth) / 2

$shadowBrushText = New-Object System.Drawing.SolidBrush((New-Color 160 0 0 0))
$graphics.DrawString($rockyText, $rockyFont, $shadowBrushText, $textX + 6, $textY + 6)
$graphics.DrawString($maxxText, $maxxFont, $shadowBrushText, $textX + $rockySize.Width - 8 + 6, $textY + 6)

$silverBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  ([System.Drawing.PointF]::new($textX, $textY)),
  ([System.Drawing.PointF]::new($textX, $textY + 92)),
  (New-Color 255 244 244 244),
  (New-Color 255 100 100 108)
)
$orangeBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  ([System.Drawing.PointF]::new($textX, $textY)),
  ([System.Drawing.PointF]::new($textX, $textY + 92)),
  (New-Color 255 255 180 96),
  (New-Color 255 170 92 34)
)
$graphics.DrawString($rockyText, $rockyFont, $silverBrush, $textX, $textY)
$graphics.DrawString($maxxText, $maxxFont, $orangeBrush, $textX + $rockySize.Width - 8, $textY)

$outlinePathRocky = New-Object System.Drawing.Drawing2D.GraphicsPath
$outlinePathRocky.AddString($rockyText, $rockyFont.FontFamily, [int]$rockyFont.Style, $rockyFont.Size, [System.Drawing.Point]::new([int]$textX, [int]$textY), [System.Drawing.StringFormat]::GenericDefault)
$outlinePathMaxx = New-Object System.Drawing.Drawing2D.GraphicsPath
$outlinePathMaxx.AddString($maxxText, $maxxFont.FontFamily, [int]$maxxFont.Style, $maxxFont.Size, [System.Drawing.Point]::new([int]($textX + $rockySize.Width - 8), [int]$textY), [System.Drawing.StringFormat]::GenericDefault)
$outlinePen = New-Object System.Drawing.Pen((New-Color 110 16 16 18), 4)
$outlinePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($outlinePen, $outlinePathRocky)
$graphics.DrawPath($outlinePen, $outlinePathMaxx)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# ICO with embedded 256x256 PNG
$iconBitmap = New-Object System.Drawing.Bitmap 256, 256
$iconBitmap.SetResolution(96, 96)
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconGraphics.Clear([System.Drawing.Color]::Transparent)
$iconGraphics.DrawImage($bitmap, 0, 0, 256, 256)

$memoryStream = New-Object System.IO.MemoryStream
$iconBitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $memoryStream.ToArray()
$memoryStream.Dispose()

$fileStream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter $fileStream
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
$writer.Dispose()
$fileStream.Dispose()

foreach ($targetDir in $appTargets) {
  Copy-Item $icoPath (Join-Path $targetDir "icon.ico") -Force
  Copy-Item $pngPath (Join-Path $targetDir "icon.png") -Force
}

$outlinePen.Dispose()
$outlinePathRocky.Dispose()
$outlinePathMaxx.Dispose()
$orangeBrush.Dispose()
$silverBrush.Dispose()
$shadowBrushText.Dispose()
$rockyFont.Dispose()
$maxxFont.Dispose()
$slashHighlight.Dispose()
$metalPen.Dispose()
$accentPen.Dispose()
$darkPen.Dispose()
$highlightPen.Dispose()
$highlightPath.Dispose()
$innerPen.Dispose()
$matrix.Dispose()
$innerPath.Dispose()
$outerPen.Dispose()
$shieldGradient.Dispose()
$shieldPath.Dispose()
$graphics.Dispose()
$iconGraphics.Dispose()
$iconBitmap.Dispose()
$bitmap.Dispose()

Write-Host "Logo generado:"
Write-Host " - $pngPath"
Write-Host " - $icoPath"
