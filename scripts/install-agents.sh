#!/bin/bash
# Install AI Agent CLIs for Bob
# Usage: ./scripts/install-agents.sh [--all] [--claude] [--codex] [--gemini] [--opencode] [--kiro] [--cursor-agent]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)

# Detect if running in Docker
is_docker() {
    [ -f /.dockerenv ] || [ "$DOCKER_ENV" = "true" ]
}

# Get target bin directory for system-wide installation
get_system_bin_dir() {
    echo "/usr/local/bin"
}

# ============================================
# Claude Code
# https://docs.anthropic.com/en/docs/claude-code
# ============================================
install_claude() {
    print_header "Installing Claude Code"
    
    if command_exists claude; then
        local version=$(claude --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "Claude Code is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing Claude Code via npm..."
    npm install -g @anthropic-ai/claude-code
    
    if command_exists claude; then
        print_success "Claude Code installed successfully"
        print_status "Run 'claude' to authenticate and start using"
    else
        print_error "Claude Code installation failed"
        return 1
    fi
}

# ============================================
# OpenAI Codex CLI
# https://github.com/openai/codex
# ============================================
install_codex() {
    print_header "Installing Codex CLI"
    
    if command_exists codex; then
        local version=$(codex --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "Codex is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing Codex CLI via npm..."
    npm install -g @openai/codex
    
    if command_exists codex; then
        print_success "Codex CLI installed successfully"
        print_status "Set OPENAI_API_KEY environment variable to authenticate"
    else
        print_error "Codex CLI installation failed"
        return 1
    fi
}

# ============================================
# Google Gemini CLI
# https://github.com/google-gemini/gemini-cli
# ============================================
install_gemini() {
    print_header "Installing Gemini CLI"
    
    if command_exists gemini; then
        local version=$(gemini --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "Gemini CLI is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing Gemini CLI via npm..."
    npm install -g @google/gemini-cli
    
    if command_exists gemini; then
        print_success "Gemini CLI installed successfully"
        print_status "Run 'gemini auth login' to authenticate"
    else
        print_error "Gemini CLI installation failed"
        return 1
    fi
}

# ============================================
# OpenCode
# https://opencode.ai
# ============================================
install_opencode() {
    print_header "Installing OpenCode"
    
    if command_exists opencode; then
        local version=$(opencode --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "OpenCode is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing OpenCode via curl..."
    curl -fsSL https://opencode.ai/install | bash
    
    # In Docker, copy to system path since installer puts binary in ~/.opencode/bin/
    if is_docker; then
        local src="$HOME/.opencode/bin/opencode"
        local dest="$(get_system_bin_dir)/opencode"
        if [ -f "$src" ]; then
            cp "$src" "$dest" && chmod +x "$dest"
            print_status "Copied opencode to $dest for Docker compatibility"
        fi
    fi
    
    if command_exists opencode; then
        print_success "OpenCode installed successfully"
        print_status "Run 'opencode' to start using"
    else
        print_error "OpenCode installation failed"
        print_status "Try manual install: https://opencode.ai/docs/installation"
        return 1
    fi
}

# ============================================
# Kiro CLI
# https://kiro.dev
# ============================================
install_kiro() {
    print_header "Installing Kiro CLI"
    
    if command_exists kiro-cli; then
        local version=$(kiro-cli --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "Kiro CLI is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing Kiro CLI via curl..."
    curl -fsSL https://cli.kiro.dev/install | bash
    
    # In Docker, copy to system path since installer puts binary in ~/.local/bin/
    if is_docker; then
        local dest="$(get_system_bin_dir)"
        if ls "$HOME/.local/bin/kiro-cli"* 1>/dev/null 2>&1; then
            cp "$HOME/.local/bin/kiro-cli"* "$dest/" 2>/dev/null
            chmod +x "$dest/kiro-cli"* 2>/dev/null
            print_status "Copied kiro-cli to $dest for Docker compatibility"
        fi
    fi
    
    if command_exists kiro-cli; then
        print_success "Kiro CLI installed successfully"
        print_status "Run 'kiro-cli chat' to start using"
    else
        print_error "Kiro CLI installation failed"
        return 1
    fi
}

# ============================================
# Cursor Agent
# https://cursor.com
# ============================================
install_cursor_agent() {
    print_header "Installing Cursor Agent"
    
    if command_exists cursor-agent; then
        local version=$(cursor-agent --version 2>/dev/null | head -1 || echo "unknown")
        print_warning "Cursor Agent is already installed: $version"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi
    
    print_status "Installing Cursor Agent via npm..."
    npm install -g cursor-agent
    
    if command_exists cursor-agent; then
        print_success "Cursor Agent installed successfully"
        print_status "Set CURSOR_API_KEY environment variable to authenticate"
    else
        print_error "Cursor Agent installation failed"
        print_status "Note: Cursor Agent may require Cursor IDE to be installed"
        return 1
    fi
}

# ============================================
# Install All
# ============================================
install_all() {
    print_header "Installing All AI Agents"
    
    local failed=()
    
    install_claude || failed+=("claude")
    install_codex || failed+=("codex")
    install_gemini || failed+=("gemini")
    install_opencode || failed+=("opencode")
    install_kiro || failed+=("kiro")
    install_cursor_agent || failed+=("cursor-agent")
    
    echo ""
    print_header "Installation Summary"
    
    if [ ${#failed[@]} -eq 0 ]; then
        print_success "All agents installed successfully!"
    else
        print_warning "Some agents failed to install: ${failed[*]}"
    fi
}

# ============================================
# Check Status
# ============================================
check_status() {
    print_header "AI Agent Status"
    
    echo ""
    printf "%-20s %-15s %s\n" "AGENT" "STATUS" "VERSION"
    printf "%-20s %-15s %s\n" "────────────────────" "───────────────" "──────────────────────"
    
    # Claude
    if command_exists claude; then
        local version=$(claude --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "Claude Code" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "Claude Code" "Not installed" "-"
    fi
    
    # Codex
    if command_exists codex; then
        local version=$(codex --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "Codex" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "Codex" "Not installed" "-"
    fi
    
    # Gemini
    if command_exists gemini; then
        local version=$(gemini --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "Gemini" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "Gemini" "Not installed" "-"
    fi
    
    # OpenCode
    if command_exists opencode; then
        local version=$(opencode --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "OpenCode" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "OpenCode" "Not installed" "-"
    fi
    
    # Kiro
    if command_exists kiro-cli; then
        local version=$(kiro-cli --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "Kiro" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "Kiro" "Not installed" "-"
    fi
    
    # Cursor Agent
    if command_exists cursor-agent; then
        local version=$(cursor-agent --version 2>/dev/null | head -1 || echo "unknown")
        printf "%-20s ${GREEN}%-15s${NC} %s\n" "Cursor Agent" "Installed" "$version"
    else
        printf "%-20s ${RED}%-15s${NC} %s\n" "Cursor Agent" "Not installed" "-"
    fi
    
    echo ""
}

# ============================================
# Help
# ============================================
print_help() {
    echo "Bob AI Agent Installer"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --all             Install all AI agents"
    echo "  --claude          Install Claude Code"
    echo "  --codex           Install Codex CLI"
    echo "  --gemini          Install Gemini CLI"
    echo "  --opencode        Install OpenCode"
    echo "  --kiro            Install Kiro CLI"
    echo "  --cursor-agent    Install Cursor Agent"
    echo "  --status          Check installation status of all agents"
    echo "  --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --all                    # Install all agents"
    echo "  $0 --claude --gemini        # Install only Claude and Gemini"
    echo "  $0 --status                 # Check which agents are installed"
    echo ""
}

# ============================================
# Main
# ============================================

# Check for npm
if ! command_exists npm; then
    print_error "npm is required but not installed"
    print_status "Please install Node.js and npm first: https://nodejs.org"
    exit 1
fi

# Parse arguments
if [ $# -eq 0 ]; then
    print_help
    exit 0
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            install_all
            shift
            ;;
        --claude)
            install_claude
            shift
            ;;
        --codex)
            install_codex
            shift
            ;;
        --gemini)
            install_gemini
            shift
            ;;
        --opencode)
            install_opencode
            shift
            ;;
        --kiro)
            install_kiro
            shift
            ;;
        --cursor-agent)
            install_cursor_agent
            shift
            ;;
        --status)
            check_status
            shift
            ;;
        --help|-h)
            print_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            print_help
            exit 1
            ;;
    esac
done

echo ""
print_status "Done! Run '$0 --status' to see installation status."
