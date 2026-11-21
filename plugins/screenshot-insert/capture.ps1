# DSH screenshot capture helper for Windows: one long-lived worker.
#
# The Host plugin starts this process once, then writes one JSON request per
# line to stdin and reads one JSON response per line from stdout. The worker
# compiles its native helpers and sets DPI awareness once, so every later
# capture is fast. Requests carry only mode names, output paths and numeric
# window handles; no request data ever becomes script text.
#
# Request:  {"mode":"area","output":"C:\\...\\screen.png"}
#           {"mode":"area-clean","output":"..."}
#           {"mode":"window","output":"...","window":"123456"}
#           {"mode":"list"}
# Response: {"ok":true,"width":123,"height":456}
#           {"ok":true,"windows":[{"id":"...","title":"...","process":"...","iconic":false}]}
#           {"ok":false,"error":"..."}
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class DshScreen
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

    public const int GwlExStyle = -20;
    public const int WsExToolWindow = 0x80;
    public const int SwMinimize = 6;
    public const int SwMaximize = 3;
    public const int SwRestore = 9;
    public const int DwmwaExtendedFrameBounds = 9;

    public class WindowInfo
    {
        public IntPtr Handle;
        public string Title;
        public string Process;
        public string Class;
        public bool Iconic;
    }

    public static bool EnableDpiAwareness()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true; } catch { }
        try { return SetProcessDPIAware(); } catch { }
        return false;
    }

    public static string TitleOf(IntPtr hwnd)
    {
        int length = GetWindowTextLength(hwnd);
        if (length <= 0) return "";
        StringBuilder builder = new StringBuilder(length + 1);
        GetWindowText(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    public static string ClassOf(IntPtr hwnd)
    {
        StringBuilder builder = new StringBuilder(256);
        GetClassName(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    public static string ProcessOf(IntPtr hwnd)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0) return "";
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static WindowInfo Describe(IntPtr hwnd)
    {
        WindowInfo info = new WindowInfo();
        info.Handle = hwnd;
        info.Title = TitleOf(hwnd);
        info.Process = ProcessOf(hwnd);
        info.Class = ClassOf(hwnd);
        info.Iconic = IsIconic(hwnd);
        return info;
    }

    private static bool IsCapturable(IntPtr hwnd)
    {
        if (!IsWindowVisible(hwnd)) return false;
        int exStyle = GetWindowLong(hwnd, GwlExStyle);
        if ((exStyle & WsExToolWindow) != 0) return false;
        string title = TitleOf(hwnd);
        if (title.Length == 0) return false;
        string cls = ClassOf(hwnd);
        if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Windows.UI.Core.CoreWindow") return false;
        return ProcessOf(hwnd).Length > 0;
    }

    public static List<WindowInfo> ListWindows()
    {
        List<WindowInfo> list = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr param)
        {
            if (IsCapturable(hwnd)) list.Add(Describe(hwnd));
            return true;
        }, IntPtr.Zero);
        list.Sort(delegate(WindowInfo a, WindowInfo b)
        {
            return string.Compare(a.Process + " " + a.Title, b.Process + " " + b.Title, StringComparison.OrdinalIgnoreCase);
        });
        return list;
    }

    public static IntPtr FindWindow(string processName, string titleNeedle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr param)
        {
            if (found != IntPtr.Zero) return false;
            if (!IsWindowVisible(hwnd)) return true;
            string title = TitleOf(hwnd);
            if (title.Length == 0) return true;
            string process = ProcessOf(hwnd);
            bool processMatches = processName.Length > 0 && string.Equals(process, processName, StringComparison.OrdinalIgnoreCase);
            bool titleMatches = titleNeedle.Length > 0 && title.IndexOf(titleNeedle, StringComparison.OrdinalIgnoreCase) >= 0;
            if (processMatches || titleMatches) found = hwnd;
            return found == IntPtr.Zero;
        }, IntPtr.Zero);
        return found;
    }

    public static bool ForceForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SwRestore);
        if (SetForegroundWindow(hwnd)) return true;
        IntPtr foreground = GetForegroundWindow();
        if (foreground == hwnd) return true;
        uint foregroundPid;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundPid);
        uint targetPid;
        uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
        if (foregroundThread == 0 || targetThread == 0 || foregroundThread == targetThread) return false;
        bool attached = false;
        try
        {
            attached = AttachThreadInput(foregroundThread, targetThread, true);
            bool ok = SetForegroundWindow(hwnd);
            if (!ok) { ShowWindow(hwnd, SwRestore); ok = SetForegroundWindow(hwnd); }
            return ok;
        }
        finally
        {
            if (attached) AttachThreadInput(foregroundThread, targetThread, false);
        }
    }

    public static int[] WindowBounds(IntPtr hwnd)
    {
        RECT rect = new RECT();
        bool ok = false;
        try
        {
            if (DwmGetWindowAttribute(hwnd, DwmwaExtendedFrameBounds, out rect, Marshal.SizeOf(typeof(RECT))) == 0)
                ok = rect.Right > rect.Left && rect.Bottom > rect.Top;
        }
        catch
        {
            ok = false;
            rect = new RECT();
        }
        if (!ok) ok = GetWindowRect(hwnd, out rect);
        if (!ok || rect.Right <= rect.Left || rect.Bottom <= rect.Top) return null;
        return new int[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
    }
}
'@
[void][DshScreen]::EnableDpiAwareness()

function Save-VirtualScreen([string]$path) {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $width = [Math]::Max(1, $bounds.Width)
    $height = [Math]::Max(1, $bounds.Height)
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    return @($width, $height)
}

function Save-ScreenRect([string]$path, [int]$left, [int]$top, [int]$width, [int]$height) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    return @($width, $height)
}

function Find-DshWindow() {
    $foreground = [DshScreen]::GetForegroundWindow()
    if ($foreground -ne [IntPtr]::Zero -and [DshScreen]::ProcessOf($foreground) -eq 'DeepSeek Harness') { return $foreground }
    return [DshScreen]::FindWindow('DeepSeek Harness', 'DeepSeek Harness')
}

function Write-Response([object]$payload) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $payload -Compress -Depth 6))
    [Console]::Out.Flush()
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    try {
        $request = ConvertFrom-Json -InputObject $line
        $mode = [string]$request.mode
        $output = [string]$request.output
        switch ($mode) {
            'list' {
                $items = New-Object System.Collections.ArrayList
                foreach ($window in [DshScreen]::ListWindows()) {
                    [void]$items.Add([pscustomobject]@{
                        id = $window.Handle.ToInt64().ToString()
                        title = $window.Title
                        process = $window.Process
                        iconic = $window.Iconic
                    })
                }
                Write-Response ([pscustomobject]@{ ok = $true; windows = $items })
            }
            'area' {
                $size = Save-VirtualScreen $output
                Write-Response ([pscustomobject]@{ ok = $true; width = $size[0]; height = $size[1] })
            }
            'area-clean' {
                $target = Find-DshWindow
                $wasIconic = $false
                $wasZoomed = $false
                if ($target -ne [IntPtr]::Zero) {
                    $wasIconic = [DshScreen]::IsIconic($target)
                    $wasZoomed = [DshScreen]::IsZoomed($target)
                    if (-not $wasIconic) { [void][DshScreen]::ShowWindow($target, 6) }
                    Start-Sleep -Milliseconds 350
                }
                try {
                    $size = Save-VirtualScreen $output
                } finally {
                    if ($target -ne [IntPtr]::Zero -and -not $wasIconic) {
                        if ($wasZoomed) { [void][DshScreen]::ShowWindow($target, 3) } else { [void][DshScreen]::ShowWindow($target, 9) }
                        [void][DshScreen]::ForceForeground($target)
                    }
                }
                Write-Response ([pscustomobject]@{ ok = $true; width = $size[0]; height = $size[1] })
            }
            'window' {
                $handleText = [string]$request.window
                if ($handleText.Length -eq 0) { throw 'missing window handle' }
                $target = [IntPtr][long]$handleText
                if ($target -eq [IntPtr]::Zero) { throw 'invalid window handle' }
                if (-not [DshScreen]::IsWindowVisible($target)) { throw 'the window is no longer visible' }
                $previous = [DshScreen]::GetForegroundWindow()
                $wasIconic = [DshScreen]::IsIconic($target)
                $dsh = Find-DshWindow
                $dshChanged = $false
                $dshWasZoomed = $false
                try {
                    if ($target -ne $dsh -and $dsh -ne [IntPtr]::Zero -and -not [DshScreen]::IsIconic($dsh)) {
                        $dshWasZoomed = [DshScreen]::IsZoomed($dsh)
                        [void][DshScreen]::ShowWindow($dsh, 6)
                        $dshChanged = $true
                        Start-Sleep -Milliseconds 250
                    }
                    if ($wasIconic) { [void][DshScreen]::ShowWindow($target, 9) }
                    [void][DshScreen]::ForceForeground($target)
                    Start-Sleep -Milliseconds 420
                    $bounds = [DshScreen]::WindowBounds($target)
                    if ($null -eq $bounds) { throw 'could not read the window bounds' }
                    $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
                    $left = [Math]::Max($bounds[0], $virtual.Left)
                    $top = [Math]::Max($bounds[1], $virtual.Top)
                    $right = [Math]::Min($bounds[2], $virtual.Right)
                    $bottom = [Math]::Min($bounds[3], $virtual.Bottom)
                    $width = $right - $left
                    $height = $bottom - $top
                    if ($width -lt 2 -or $height -lt 2) { throw 'the window is outside the visible desktop' }
                    $size = Save-ScreenRect $output $left $top $width $height
                } finally {
                    if ($wasIconic) { [void][DshScreen]::ShowWindow($target, 6) }
                    if ($dshChanged -and $dsh -ne [IntPtr]::Zero) {
                        if ($dshWasZoomed) { [void][DshScreen]::ShowWindow($dsh, 3) } else { [void][DshScreen]::ShowWindow($dsh, 9) }
                        [void][DshScreen]::ForceForeground($dsh)
                    }
                    if ($previous -ne [IntPtr]::Zero -and $previous -ne $target -and $previous -ne $dsh) {
                        [void][DshScreen]::ForceForeground($previous)
                    }
                }
                Write-Response ([pscustomobject]@{ ok = $true; width = $size[0]; height = $size[1] })
            }
            'state' {
                $foreground = [DshScreen]::GetForegroundWindow()
                $dsh = Find-DshWindow
                Write-Response ([pscustomobject]@{
                    ok = $true
                    foregroundProcess = [DshScreen]::ProcessOf($foreground)
                    dshHandle = $dsh.ToInt64().ToString()
                    dshIconic = ($dsh -ne [IntPtr]::Zero -and [DshScreen]::IsIconic($dsh))
                })
            }
            default {
                throw ('unknown mode: ' + $mode)
            }
        }
    } catch {
        Write-Response ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
    }
}
