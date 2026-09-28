.PHONY: install content test ios-build ios-install ios-run check-expo tour

-include Local.mk
DEVICE ?= $(error set DEVICE=<udid> or put it in Local.mk)
APP = app/ios/build/Build/Products/Release-iphoneos/DistributedSims.app

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
	  -xcconfig Local.xcconfig -allowProvisioningUpdates build | tail -30

ios-install:
	xcrun devicectl device install app --device $(DEVICE) $(APP)

ios-run: ios-install
	xcrun devicectl device process launch --device $(DEVICE) --terminate-existing dev.distributedsims.app

check-expo:
	@! grep -Eq '"node_modules/(@expo/|expo["/])' app/package-lock.json || (echo "expo package found" && exit 1)

TOUR_OUT ?= /tmp/dsims-tour/$(shell date +%H%M%S)

# Run the debug snapshot tour on the phone, then pull the PNGs (needs the phone unlocked).
tour:
	xcrun devicectl device process launch --device $(DEVICE) --terminate-existing --payload-url 'dsims://tour' dev.distributedsims.app
	sleep 75
	mkdir -p $(TOUR_OUT)
	xcrun devicectl device copy from --device $(DEVICE) --domain-type appDataContainer --domain-identifier dev.distributedsims.app --source Documents/tour --destination $(TOUR_OUT)
	@echo "screenshots in $(TOUR_OUT)"
