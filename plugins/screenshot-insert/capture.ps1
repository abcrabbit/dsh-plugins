# Capture the monitor under the mouse cursor to a PNG file.
#
# The Host plugin passes the destination path in DSH_SCREENSHOT_OUT; this
# script is constant and user input never becomes script text. The process is
# made per-monitor DPI aware before any screen API is touched so the captured
# pixels and the CopyFromScreen coordinates share one physical coordinate
# space on scaled displays.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshScreenshotDpi {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
'@
$aware = $false
try { $aware = [DshScreenshotDpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { $aware = $false }
if (-not $aware) {
    try { [void][DshScreenshotDpi]::SetProcessDPIAware() } catch { }
}
$screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
    $bitmap.Save($env:DSH_SCREENSHOT_OUT, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
