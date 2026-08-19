import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class NotificationsViewModel {
    var notifications: [AppNotification] = []
    var nextCursor: String? = nil
    var isLoading = false
    var isLoadingMore = false
    var errorMessage: String?
    var unreadCount = 0

    var hasMore: Bool { nextCursor != nil }

    func load(token: String) async {
        isLoading = true
        errorMessage = nil
        do {
            async let fetchItems = APIClient.shared.notifications(token: token)
            async let fetchCount = APIClient.shared.notificationsUnreadCount(token: token)
            let (r, count) = try await (fetchItems, fetchCount)
            notifications = r.items
            nextCursor = r.nextCursor
            unreadCount = count
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(token: String) async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        do {
            let r = try await APIClient.shared.notifications(token: token, before: cursor)
            notifications.append(contentsOf: r.items)
            nextCursor = r.nextCursor
        } catch {
            // silently ignore load-more failures
        }
        isLoadingMore = false
    }
}

// MARK: - View

struct NotificationsView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = NotificationsViewModel()

    var body: some View {
        List {
            ForEach(vm.notifications) { notification in
                NotificationRow(notification: notification)
            }

            if vm.hasMore {
                HStack {
                    Spacer()
                    if vm.isLoadingMore {
                        ProgressView()
                    } else {
                        Button("Load More") {
                            Task { await vm.loadMore(token: auth.token ?? "") }
                        }
                        .foregroundStyle(Color.brandOrange)
                    }
                    Spacer()
                }
            }

            if vm.notifications.isEmpty && !vm.isLoading {
                EmptyStateView(
                    icon: "bell",
                    title: "No Notifications",
                    message: "You're all caught up."
                )
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .navigationTitle("Notifications")
        .toolbar {
            if vm.unreadCount > 0 {
                ToolbarItem(placement: .automatic) {
                    Text("\(vm.unreadCount) unread")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .overlay { if vm.isLoading { ProgressView() } }
        .refreshable { await reload() }
        .task { await reload() }
        .alert("Error", isPresented: Binding(get: { vm.errorMessage != nil }, set: { _ in vm.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(vm.errorMessage ?? "") }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token)
    }
}

// MARK: - Row

private struct NotificationRow: View {
    let notification: AppNotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(notification.read ? Color.secondary.opacity(0.2) : Color.brandOrange)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 4) {
                Text(notification.summary)
                    .font(.subheadline)
                    .fontWeight(notification.read ? .regular : .semibold)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    if let actor = notification.actorName {
                        Text(actor)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let type = notification.entityType {
                        Text("·").foregroundStyle(.tertiary).font(.caption)
                        Text(type.capitalized)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Text(notification.createdAt.formattedDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
