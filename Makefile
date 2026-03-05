.PHONY: all install build dev electron clean

# Build everything and launch Electron
all: install build electron

# Install dependencies (root + webview + electron)
install:
	npm install
	cd webview-ui && npm install
	cd electron && npm install

# Build extension + webview
build:
	npm run compile

# Watch mode (extension + types)
dev:
	npm run watch

# Build webview + launch Electron standalone app
electron:
	npm run electron:dev

# Package Electron app (dmg/AppImage/nsis)
electron-package:
	npm run electron:build

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf webview-ui/dist
	cd electron && npm run clean
