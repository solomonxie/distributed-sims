.PHONY: install content test typecheck ios-build ios-strip ios-install ios-run check-expo tour release screenshots

-include Local.mk
DEVICE ?= $(error set DEVICE=<udid> or put it in Local.mk)
APP = app/ios/build/Build/Products/Release-iphoneos/DistributedSims.app
BUNDLE_ID := $(or $(shell sed -n "s/^PRODUCT_BUNDLE_IDENTIFIER *= *//p" app/ios/Local.xcconfig 2>/dev/null),dev.distributedsims.app)

install:
	cd app && npm install && cd ios && pod install
	cd engine && npm install
	cd scripts && npm install

content:
	node scripts/build-content.mjs

test: check-expo content
	cd engine && npx jest
	cd scripts && node validate-content.mjs

ios-build: content
	cd app/ios && xcodebuild -workspace DistributedSims.xcworkspace -scheme DistributedSims \
	  -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build \
	  -allowProvisioningUpdates DSIMS_TOUR=YES \
	  DEPLOYMENT_POSTPROCESSING=YES STRIP_INSTALLED_PRODUCT=YES STRIP_STYLE=all build | tail -30
	$(MAKE) ios-strip

# Prebuilt RN frameworks ship with local symbols (~15 MB); strip them and re-sign with the build's identity.
ios-strip:
	@ID=$$(codesign -dvv $(APP) 2>&1 | sed -n 's/^Authority=\(Apple Development.*\)/\1/p' | head -1); \
	codesign -d --entitlements - --xml $(APP) > /tmp/dsims-ent.plist 2>/dev/null; \
	for f in $(APP)/Frameworks/*.framework; do strip -x "$$f/$$(basename $$f .framework)" 2>/dev/null; codesign -f -s "$$ID" --timestamp=none "$$f"; done; \
	codesign -f -s "$$ID" --entitlements /tmp/dsims-ent.plist --timestamp=none $(APP); \
	codesign --verify --deep --strict $(APP) && du -sh $(APP)

ios-install:
	xcrun devicectl device install app --device $(DEVICE) $(APP)

ios-run: ios-install
	xcrun devicectl device process launch --device $(DEVICE) --terminate-existing $(BUNDLE_ID)

typecheck:
	cd app && npx tsc --noEmit

# Archive Release and upload to App Store Connect (BUILD=<n> to override the timestamp).
release: test typecheck
	@git diff --quiet HEAD -- || echo "warning: uncommitted changes are going into this build"
	scripts/release-ios.sh $(BUILD)

# Resize phone shots in SHOTS=<dir> into docs/release/screenshots/{6.9,6.5}.
screenshots:
	scripts/store-screenshots.sh $(or $(SHOTS),$(error set SHOTS=<dir>))

check-expo:
	@! grep -Eq '"node_modules/(@expo/|expo["/])' app/package-lock.json || (echo "expo package found" && exit 1)

TOUR_OUT ?= /tmp/dsims-tour/$(shell date +%H%M%S)

# Run the debug snapshot tour on the phone, then pull the PNGs (needs the phone unlocked and a `make ios-build` install; App Store builds ignore dsims://tour).
tour:
	xcrun devicectl device process launch --device $(DEVICE) --terminate-existing --payload-url 'dsims://tour' $(BUNDLE_ID)
	sleep 75
	mkdir -p $(TOUR_OUT)
	xcrun devicectl device copy from --device $(DEVICE) --domain-type appDataContainer --domain-identifier $(BUNDLE_ID) --source Documents/tour --destination $(TOUR_OUT)
	@echo "screenshots in $(TOUR_OUT)"
