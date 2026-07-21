PREFIX ?= /usr/share/cockpit
NAME = inflighttv
INSTALL_DIR = $(PREFIX)/$(NAME)
SYSCONF ?= /etc/cockpit/$(NAME)
VERSION := $(shell cat VERSION)
TAG := v$(VERSION)
ZIP := $(NAME)-$(VERSION).zip

# Release notes for `make publish`. Override on the command line, e.g.
#   make publish RELEASE_NOTES="Fix the thing"
# Exported so the recipe can read it as $$RELEASE_NOTES and write it verbatim to a
# file — keeps multi-line / quoted notes intact.
RELEASE_NOTES ?= Release $(VERSION)
export RELEASE_NOTES

.PHONY: all help version build dev-link install uninstall test zip publish clean

all: help

help:
	@echo "InFlight TV (Cockpit plugin) — version $(VERSION)"
	@echo
	@echo "Targets:"
	@echo "  make build      Build dist/ with Vite (npm ci && npm run build)"
	@echo "  make dev-link   Symlink dist/ into ~/.local/share/cockpit (no root)"
	@echo "  make install    Copy dist/ to $(INSTALL_DIR) (use sudo; builds as the sudo user)"
	@echo "  make uninstall  Remove $(INSTALL_DIR) (use sudo)"
	@echo "  make test       Run unit tests + typecheck"
	@echo "  make zip        Produce $(ZIP) (the built, installable plugin)"
	@echo "  make publish    Build the zip and publish it as GitHub release $(TAG)"
	@echo "  make version    Print current version"
	@echo "  make clean      Remove build artifacts"

version:
	@echo $(VERSION)

# Unlike explorer (pure JS, no build), this is a Vite app — everything ships from dist/.
build:
	npm ci
	npm run build

dev-link: build
	mkdir -p $(HOME)/.local/share/cockpit
	ln -sfn $(CURDIR)/dist $(HOME)/.local/share/cockpit/$(NAME)
	@echo "Linked dist/ → ~/.local/share/cockpit/$(NAME). Reload Cockpit; look under Tools → InFlight TV."

test:
	npm run test
	npm run typecheck

# Root must never run npm (sudo strips the user's PATH, where nvm-installed npm
# lives). Build as the invoking user via SUDO_USER instead; without sudo context,
# fall back to a pre-built dist/.
install:
	@if [ "$$(id -u)" != "0" ]; then echo "install requires root (use sudo)"; exit 1; fi
	@if [ -n "$$SUDO_USER" ]; then \
	  echo "Building as $$SUDO_USER"; \
	  sudo -u "$$SUDO_USER" -i -- $(MAKE) -C "$(CURDIR)" build || exit 1; \
	elif [ ! -d dist ]; then \
	  echo "dist/ not found — run 'make build' first, then 'sudo make install'"; exit 1; \
	fi
	@if [ -d $(INSTALL_DIR) ]; then echo "Removing previous install at $(INSTALL_DIR)"; rm -rf $(INSTALL_DIR); fi
	install -d $(INSTALL_DIR)
	cp -r dist/. $(INSTALL_DIR)/
	@# Record the installed version.
	install -d $(SYSCONF)
	printf '%s\n' "$(VERSION)" > $(SYSCONF)/installed-version
	@echo
	@echo "Installed InFlight TV $(VERSION) to $(INSTALL_DIR)"
	@echo "Restart Cockpit with: systemctl try-restart cockpit"
	@echo "Then reload Cockpit in the browser. Look under 'Tools → InFlight TV'."

uninstall:
	@if [ "$$(id -u)" != "0" ]; then echo "uninstall requires root (use sudo)"; exit 1; fi
	rm -rf $(INSTALL_DIR)
	@echo "Removed $(INSTALL_DIR)"
	@echo "Note: left $(SYSCONF) in place. Remove it manually if desired."

# The zip is the BUILT plugin (dist/), i.e. exactly what gets installed.
zip: build
	@tmp=$$(mktemp -d); \
	mkdir "$$tmp/$(NAME)"; \
	cp -r dist/. "$$tmp/$(NAME)/"; \
	(cd "$$tmp" && zip -rq "$(ZIP)" $(NAME) -x '$(NAME)/$(NAME)-*.zip'); \
	mv "$$tmp/$(ZIP)" .; \
	rm -rf "$$tmp"; \
	echo "Wrote $(ZIP)"

# Build the zip and publish it as a GitHub release tagged $(TAG) (= v$(VERSION)),
# uploading $(ZIP) as the release asset. The repo is detected from the git "origin"
# remote by the gh CLI. Commit & push first so the tag points at your latest commit.
publish: zip
	@command -v gh >/dev/null 2>&1 || { echo "gh CLI not found — install it first."; exit 1; }
	@gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated — run: gh auth login"; exit 1; }
	@notes="$$(mktemp)"; trap 'rm -f "$$notes"' EXIT; \
	printf '%s\n' "$$RELEASE_NOTES" > "$$notes"; \
	if gh release view "$(TAG)" >/dev/null 2>&1; then \
	  echo "Release $(TAG) already exists — uploading asset (clobber)"; \
	  gh release upload "$(TAG)" "$(ZIP)" --clobber; \
	  gh release edit "$(TAG)" --notes-file "$$notes"; \
	else \
	  echo "Creating release $(TAG)"; \
	  gh release create "$(TAG)" "$(ZIP)" --title "InFlight TV $(VERSION)" --notes-file "$$notes"; \
	fi
	@echo "Published $(TAG) ($(ZIP))"
	@rm -f "$(ZIP)"
	@echo "Removed local $(ZIP)"

clean:
	rm -rf dist $(NAME)-*.zip
