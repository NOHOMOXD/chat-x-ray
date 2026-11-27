/*
 * Twitch Chat X-Ray — Tippy.js tooltip layer.
 *
 * Tippy is bundled locally (no network requests). Tooltip content is built as
 * DOM nodes, never innerHTML, and all extension-owned tooltip nodes are ignored
 * by the page MutationObserver.
 *
 * Every tooltip is rendered through t() so it follows the UI language.
 */
import tippy from 'tippy.js';
import type { Instance } from 'tippy.js';

// Keep the scroll container and disclosure control mounted during live updates.
function updateTooltipContent(current: HTMLElement, next: HTMLElement) {
  if (current.isEqualNode(next)) {
    return;
  }
  if (next.hasAttribute('data-status')) {
    current.dataset.status = next.dataset.status;
  }
  if (!next.childElementCount && !current.childElementCount) {
    if (current.textContent !== next.textContent) {
      current.textContent = next.textContent;
    }
    return;
  }

  const key = (node: Element) => node.classList.contains('tcx-tip__row')
    ? node.firstElementChild?.textContent
    : node.className || node.tagName;
  const existing = Array.from(current.children);
  let position = current.firstElementChild;
  for (const incoming of Array.from(next.children)) {
    const index = existing.findIndex((node) => key(node) === key(incoming));
    const node = index === -1 ? incoming : existing.splice(index, 1)[0] ?? incoming;
    if (node !== incoming) {
      updateTooltipContent(node as HTMLElement, incoming as HTMLElement);
    }
    if (node !== position) {
      current.insertBefore(node, position);
    }
    position = node.nextElementSibling;
  }
  for (const node of existing) {
    node.remove();
  }
}

interface TooltipRecord {
  instance: Instance;
  update: (instance: Instance) => void;
  onKey: (event: KeyboardEvent) => void;
  details: HTMLDetailsElement | null;
  disclosure?: { open: boolean } | undefined;
}

export class TooltipController {
  private instances = new WeakMap<HTMLElement, TooltipRecord>();

  attach(element: HTMLElement | null, contentFactory: () => HTMLElement, options: { interactive?: boolean; disclosure?: { open: boolean } } = {}) {
    const { interactive = false, disclosure } = options;
    if (!element) {
      return null;
    }

    this.detach(element);
    element.removeAttribute('title');

    const content = contentFactory();
    if (interactive) {
      content.tabIndex = 0;
    }
    const details = content.querySelector<HTMLDetailsElement>('details');
    if (details && disclosure) {
      details.open = disclosure.open;
    }
    const update = (instance: Instance) => {
      if (interactive) {
        updateTooltipContent(content, contentFactory());
        instance.popperInstance?.update();
      } else {
        instance.setContent(contentFactory());
      }
    };
    const instance = tippy(element, {
      content,
      onShow: update,
      theme: 'twitch',
      placement: 'top-start',
      trigger: 'mouseenter focus',
      delay: [90, 50],
      duration: [130, 80],
      maxWidth: 360,
      interactive,
      role: interactive ? 'dialog' : 'tooltip',
      hideOnClick: true,
      animation: 'fade',
      appendTo: () => document.body,
      zIndex: 100000,
      popperOptions: {
        modifiers: [
          { name: 'preventOverflow', options: { padding: 10 } },
          { name: 'flip', options: { padding: 10 } },
        ],
      },
    });

    details?.addEventListener('toggle', () => instance.popperInstance?.update());

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && instance.state.isVisible) {
        element.focus({ preventScroll: true });
        instance.hide();
      } else if (event.currentTarget === element && !event.shiftKey &&
          (event.key === 'Tab' || event.key === 'ArrowDown') && instance.state.isVisible) {
        event.preventDefault();
        (content.querySelector<HTMLElement>('summary') || content).focus();
      }
    };
    if (interactive) {
      element.addEventListener('keydown', onKey);
      instance.popper.addEventListener('keydown', onKey);
    }
    this.instances.set(element, { instance, update, onKey, details, disclosure });
    return instance;
  }

  refresh(element: HTMLElement) {
    const record = this.instances.get(element);
    if (record && record.instance.state && record.instance.state.isVisible) {
      record.update(record.instance);
    }
  }

  detach(element: HTMLElement | null) {
    if (!element) {
      return;
    }
    const record = this.instances.get(element);
    if (record) {
      if (record.details && record.disclosure) {
        record.disclosure.open = record.details.open;
      }
      element.removeEventListener('keydown', record.onKey);
      record.instance.destroy();
      this.instances.delete(element);
    }
  }
}

export const tooltipController = new TooltipController();
