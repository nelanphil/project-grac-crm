import SwiftUI

// MARK: - Brand Colors

extension Color {
    static let brandOrange = Color(red: 0.953, green: 0.424, blue: 0.129) // #f36c21
    static let brandShell  = Color(red: 0.082, green: 0.075, blue: 0.071) // #151312
    static let staffCanvas = Color(red: 0.961, green: 0.949, blue: 0.937) // #f5f2ef
}

// MARK: - Status Badge

struct BadgeView: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    static func standing(_ s: String) -> BadgeView {
        switch s {
        case "active":   return BadgeView(text: "Active",   color: .green)
        case "due_soon": return BadgeView(text: "Due Soon", color: .brandOrange)
        case "expired":  return BadgeView(text: "Expired",  color: .red)
        default:         return BadgeView(text: s.capitalized, color: .gray)
        }
    }

    static func lead(_ s: String) -> BadgeView {
        switch s {
        case "new":       return BadgeView(text: "New",       color: .blue)
        case "contacted": return BadgeView(text: "Contacted", color: .brandOrange)
        case "qualified": return BadgeView(text: "Qualified", color: .green)
        case "won":       return BadgeView(text: "Won",       color: .purple)
        case "lost":      return BadgeView(text: "Lost",      color: .gray)
        default:          return BadgeView(text: s.capitalized, color: .gray)
        }
    }

    static func invoice(_ s: String) -> BadgeView {
        switch s {
        case "paid":  return BadgeView(text: "Paid",  color: .green)
        case "open":  return BadgeView(text: "Open",  color: .brandOrange)
        case "void":  return BadgeView(text: "Void",  color: .gray)
        case "draft": return BadgeView(text: "Draft", color: .blue)
        default:      return BadgeView(text: s.capitalized, color: .gray)
        }
    }
}

// MARK: - Empty State

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundStyle(.quaternary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - KPI Card

struct KPICard: View {
    let title: String
    let value: String
    let color: Color
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Spacer()
            }
            Text(value)
                .font(.title2.bold())
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
