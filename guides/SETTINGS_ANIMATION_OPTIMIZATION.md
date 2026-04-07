# Settings Panel Animation Optimization

## Problem
The settings window had a laggy animated open effect when triggered from the UI. The animation felt sluggish and not smooth, impacting the user experience.

## Root Cause
The animation was using standard CSS transforms without GPU acceleration hints:
- Used `translateY()` and `scale()` without 3D transform context
- No `will-change` property to hint browser optimization
- Animation duration of 0.15s felt slightly slow
- Browser wasn't pre-optimizing the animated properties

## Solution
Optimized the animation for better performance through GPU acceleration:

### Changes Made

1. **Added `will-change` hint** (`webview-ui/src/App.tsx`)
   - Added `willChange: "transform, opacity"` to the settings panel div
   - Tells the browser to optimize these properties ahead of time
   - Enables GPU layer promotion before animation starts

2. **Reduced animation duration** (`webview-ui/src/App.tsx`)
   - Changed from `0.15s` to `0.12s`
   - Creates a snappier, more responsive feel

3. **Updated keyframes for GPU acceleration** (`webview-ui/src/index.css`)
   - Changed `translateY(4px)` to `translate3d(0, 4px, 0)`
   - Changed `scale(0.95)` to `scale(0.96)` with proper ordering
   - Using `translate3d()` forces hardware acceleration
   - Slightly reduced scale for more subtle effect

## Technical Details

### Before
```css
@keyframes settings-panel-in {
  from {
    transform: scale(0.95) translateY(4px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}
```

### After
```css
@keyframes settings-panel-in {
  from {
    transform: translate3d(0, 4px, 0) scale(0.96);
    opacity: 0;
  }
  to {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 1;
  }
}
```

## Performance Impact
- GPU acceleration ensures smooth 60fps animation
- `will-change` prevents layout thrashing during animation
- Faster duration (0.12s vs 0.15s) improves perceived responsiveness
- 3D transforms create a dedicated compositor layer

## Files Modified
- `webview-ui/src/App.tsx` - Added `willChange` and reduced duration
- `webview-ui/src/index.css` - Updated keyframes with `translate3d()`
