import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  // Set by SceneDelegate; some libraries (e.g. Reanimated) read the delegate's window.
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    app.window = window

    // Cold-start link: RN reads it back via Linking.getInitialURL().
    var launchOptions: [AnyHashable: Any]?
    if let url = connectionOptions.urlContexts.first?.url, Self.allowed(url) {
      launchOptions = [UIApplication.LaunchOptionsKey.url: url]
    } else if let activity = connectionOptions.userActivities.first {
      launchOptions = [UIApplication.LaunchOptionsKey.userActivityDictionary: [
        "UIApplicationLaunchOptionsUserActivityKey": activity,
        UIApplication.LaunchOptionsKey.userActivityType: activity.activityType,
      ]]
    }
#if SCREENSHOTS
    if let screen = UserDefaults.standard.string(forKey: "screen"), let url = URL(string: "dsims://tour/\(screen)") {
      launchOptions = [UIApplication.LaunchOptionsKey.url: url]
    }
#endif

    factory.startReactNative(withModuleName: "DistributedSims", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for ctx in URLContexts where Self.allowed(ctx.url) {
      RCTLinkingManager.application(UIApplication.shared, open: ctx.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity) { _ in }
  }

  // dsims://tour only in builds made with DSIMS_TOUR=YES (make ios-build), never the App Store archive.
  static func allowed(_ url: URL) -> Bool {
    url.host != "tour" || Bundle.main.object(forInfoDictionaryKey: "DSTourEnabled") as? String == "YES"
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }
}
