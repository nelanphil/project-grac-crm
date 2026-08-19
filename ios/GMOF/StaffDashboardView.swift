import SwiftUI

struct StaffDashboardView: View {
    @Environment(AuthViewModel.self) private var auth

    var body: some View {
        TabView {
            NavigationStack { HomeView() }
                .tabItem { Label("Home",      systemImage: "house.fill") }

            NavigationStack { CustomersView() }
                .tabItem { Label("Customers", systemImage: "person.2.fill") }

            NavigationStack { ContractsView() }
                .tabItem { Label("Contracts", systemImage: "doc.text.fill") }

            NavigationStack { LeadsView() }
                .tabItem { Label("Leads",     systemImage: "star.fill") }

            NavigationStack { MoreView() }
                .tabItem { Label("More",      systemImage: "ellipsis.circle.fill") }
        }
        .tint(.brandOrange)
    }
}

// MARK: - More

private struct MoreView: View {
    @Environment(AuthViewModel.self) private var auth
    @Environment(\.colorScheme) private var colorScheme
    @State private var preferredScheme: ColorScheme? = nil

    var body: some View {
        List {
            Section("Data") {
                NavigationLink(destination: InvoicesView()) {
                    Label("Invoices",      systemImage: "dollarsign.circle.fill")
                }
                NavigationLink(destination: NotificationsView()) {
                    Label("Notifications", systemImage: "bell.fill")
                }
            }

            Section("Account") {
                LabeledContent("Signed in as") {
                    Text(auth.currentUser?.email ?? "")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Role") {
                    Text(auth.currentUser?.role.capitalized ?? "")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Appearance") {
                Picker(selection: $preferredScheme) {
                    Text("System").tag(Optional<ColorScheme>.none)
                    Text("Light").tag(Optional<ColorScheme>.some(.light))
                    Text("Dark").tag(Optional<ColorScheme>.some(.dark))
                } label: {
                    Label("Theme", systemImage: "circle.lefthalf.filled")
                }
                .pickerStyle(.segmented)
            }

            Section {
                Button(role: .destructive, action: { auth.logout() }) {
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .preferredColorScheme(preferredScheme)
    }
}
