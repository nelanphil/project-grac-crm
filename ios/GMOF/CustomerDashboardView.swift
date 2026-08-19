import SwiftUI

struct CustomerDashboardView: View {
    var body: some View {
        TabView {
            NavigationStack { InvoicesView() }
                .tabItem { Label("Invoices",      systemImage: "dollarsign.circle.fill") }

            NavigationStack { NotificationsView() }
                .tabItem { Label("Notifications", systemImage: "bell.fill") }

            NavigationStack { CustomerAccountView() }
                .tabItem { Label("Account",       systemImage: "person.crop.circle.fill") }
        }
        .tint(.brandOrange)
    }
}

// MARK: - Customer Account

private struct CustomerAccountView: View {
    @Environment(AuthViewModel.self) private var auth

    var body: some View {
        List {
            Section {
                LabeledContent("Name")  { Text(auth.currentUser?.fullName ?? "") }
                LabeledContent("Email") { Text(auth.currentUser?.email ?? "") }
            }
            Section {
                Button(role: .destructive, action: { auth.logout() }) {
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
        }
        .navigationTitle("Account")
    }
}
