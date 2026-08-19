import SwiftUI

@main
struct GMOFApp: App {
    @State private var auth = AuthViewModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isAuthenticated {
                    ContentView()
                        .environment(auth)
                } else {
                    LoginView()
                        .environment(auth)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: auth.isAuthenticated)
        }
    }
}
