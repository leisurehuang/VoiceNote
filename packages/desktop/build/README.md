# Application Icons

This directory contains application icons for different platforms.

## Required Icons

- **icon.icns** - macOS icon
- **icon.ico** - Windows icon
- **icons/** - Linux icons (various PNG sizes)

## Icon Generation

### On macOS
Use the existing script:
```bash
node scripts/make-icon.mjs packages/desktop/build/icon.icns
```

### Cross-Platform
Install `electron-icon-builder`:
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=assets/icon.png --output=packages/desktop/build --flatten
```

### Manual
Convert a 1024x1024 PNG source to:
- **macOS**: Use `iconutil` (macOS) or online converter
- **Windows**: Use online ICO converter
- **Linux**: Provide PNG in sizes: 16, 32, 48, 64, 128, 256, 512, 1024

## Icon Specifications

- **Format**: PNG source should be 1024x1024 with transparent background
- **Style**: Blue gradient background with white microphone (see existing design)
- **Platform notes**:
  - macOS: .icns format with multiple sizes embedded
  - Windows: .ico format with 16x16, 32x32, 48x48, 256x256
  - Linux: PNG in various sizes (usually 256x256 for AppImage)

## Current Status
- [ ] macOS icon.icns
- [ ] Windows icon.ico
- [ ] Linux icon.png (512x512)
