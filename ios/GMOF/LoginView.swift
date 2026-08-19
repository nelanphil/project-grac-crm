import SwiftUI


struct LoginView: View {
    @Environment(AuthViewModel.self) private var auth

    @State private var identifier = ""
    @State private var password = ""
    @State private var isPasswordVisible = false
    @FocusState private var focusedField: Field?

    private enum Field { case identifier, password }

    var body: some View {
        ZStack {
            Color.brandShell.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    logoSection
                        .padding(.top, 72)
                        .padding(.bottom, 48)
                    formSection
                        .padding(.horizontal, 24)
                    footerSection
                        .padding(.top, 40)
                        .padding(.bottom, 32)
                }
            }
        }
        .onTapGesture { focusedField = nil }
    }

    // MARK: - Sections

    private var logoSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "building.2.crop.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.brandOrange)
                .padding(.bottom, 4)
            Text("GMOF")
                .font(.system(size: 38, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .tracking(4)
            Text("CRM")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.brandOrange)
                .tracking(6)
                .padding(.top, -8)
            Text("Gen-Maint-Off-FL")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.4))
                .padding(.top, 2)
        }
    }

    private var formSection: some View {
        VStack(spacing: 16) {
            identifierField
            passwordField
            if let error = auth.loginError {
                errorBanner(message: error)
            }
            signInButton
        }
    }

    private var footerSection: some View {
        Text("© 2026 General Maintenance of Florida")
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.2))
    }

    // MARK: - Fields

    private var identifierField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("EMAIL OR USERNAME")
            TextField("you@example.com", text: $identifier)
                .autocorrectionDisabled()
                .modifier(IdentifierFieldModifier())
                .foregroundStyle(.white)
                .focused($focusedField, equals: .identifier)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }
                .inputFieldStyle(isFocused: focusedField == .identifier)
        }
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("PASSWORD")
            HStack(spacing: 0) {
                Group {
                    if isPasswordVisible {
                        TextField("••••••••", text: $password)
                    } else {
                        SecureField("••••••••", text: $password)
                    }
                }
                .modifier(PasswordFieldModifier())
                .foregroundStyle(.white)
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit { submitLogin() }
                Button {
                    isPasswordVisible.toggle()
                } label: {
                    Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                        .foregroundStyle(.white.opacity(0.4))
                        .font(.system(size: 15))
                        .frame(width: 44, height: 44)
                }
            }
            .inputFieldStyle(isFocused: focusedField == .password)
        }
    }

    // MARK: - Components

    private func fieldLabel(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.white.opacity(0.5))
            .tracking(2)
    }

    private func errorBanner(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
            Text(message)
                .font(.system(size: 13))
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(Color(red: 1.0, green: 0.42, blue: 0.35))
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var signInButton: some View {
        Button(action: submitLogin) {
            ZStack {
                if auth.isLoading {
                    ProgressView().tint(.white)
                } else {
                    Text("Sign In")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(auth.isLoading ? Color.brandOrange.opacity(0.6) : Color.brandOrange)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .disabled(auth.isLoading)
        .padding(.top, 8)
    }

    private func submitLogin() {
        focusedField = nil
        Task { await auth.login(identifier: identifier, password: password) }
    }
}

// MARK: - Platform-Conditional Field Modifiers

private struct IdentifierFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .textContentType(.emailAddress)
            .textInputAutocapitalization(.never)
        #else
        content
        #endif
    }
}

private struct PasswordFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .textContentType(.password)
        #else
        content
        #endif
    }
}

// MARK: - Input Field Style

private struct InputFieldStyle: ViewModifier {
    let isFocused: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(
                        isFocused
                            ? Color(red: 0.953, green: 0.424, blue: 0.129).opacity(0.8)
                            : Color.white.opacity(0.12),
                        lineWidth: 1
                    )
            )
    }
}

private extension View {
    func inputFieldStyle(isFocused: Bool) -> some View {
        modifier(InputFieldStyle(isFocused: isFocused))
    }
}

#Preview {
    LoginView()
        .environment(AuthViewModel())
}
