import SwiftUI

struct ContentView: View {
    @Environment(AuthViewModel.self) private var auth

    var body: some View {
        if auth.currentUser?.role == "customer" {
            CustomerDashboardView()
        } else {
            StaffDashboardView()
        }
    }
}
