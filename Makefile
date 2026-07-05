PREFIX ?= /usr/share/cockpit
NAME = inflighttv
INSTALL_DIR = $(PREFIX)/$(NAME)
VERSION := $(shell cat VERSION)
TAG := v$(VERSION)

.PHONY: all help build install uninstall dev-link zip clean version

all: help

help:
	@echo "inflighttv plugin — version $(VERSION)"
	@echo "  make build      Build dist/ with Vite"
	@echo "  make dev-link   Symlink dist/ into ~/.local/share/cockpit (no root)"
	@echo "  make install    Build and copy to $(INSTALL_DIR) (use sudo)"
	@echo "  make uninstall  Remove $(INSTALL_DIR) (use sudo)"
	@echo "  make zip        Produce inflighttv-$(VERSION).zip"

version:
	@echo $(VERSION)

build:
	npm ci
	npm run build

dev-link: build
	mkdir -p $(HOME)/.local/share/cockpit
	ln -sfn $(CURDIR)/dist $(HOME)/.local/share/cockpit/$(NAME)
	@echo "Linked. Reload Cockpit; look under Tools → InFlight TV."

install: build
	@if [ "$$(id -u)" != "0" ]; then echo "install requires root (use sudo)"; exit 1; fi
	rm -rf $(INSTALL_DIR)
	install -d $(INSTALL_DIR)
	cp -r dist/. $(INSTALL_DIR)/
	@echo "Installed $(NAME) $(VERSION). Restart Cockpit: systemctl try-restart cockpit"

uninstall:
	@if [ "$$(id -u)" != "0" ]; then echo "uninstall requires root (use sudo)"; exit 1; fi
	rm -rf $(INSTALL_DIR)

zip: build
	@tmp=$$(mktemp -d); mkdir "$$tmp/$(NAME)"; cp -r dist/. "$$tmp/$(NAME)/"; \
	(cd "$$tmp" && zip -rq "$(NAME)-$(VERSION).zip" $(NAME)); \
	mv "$$tmp/$(NAME)-$(VERSION).zip" .; rm -rf "$$tmp"; \
	echo "Wrote $(NAME)-$(VERSION).zip"

clean:
	rm -rf dist $(NAME)-*.zip
