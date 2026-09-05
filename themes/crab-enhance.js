/**
 * Crab Theme Suite - Native DOM Enhancement Engine
 *
 * 目标：在不改变 Typora 原生状态与事件链的前提下，增强桌面 UI 的可视层。
 * - 原生 select 保留为真实表单/React 状态源，自定义 combobox 只负责显示与交互
 * - 下拉面板使用 body portal，避免被 modal、sidebar、overflow 容器裁切
 * - 支持动态 option、React 受控组件、键盘导航、无障碍属性与主题变量
 * - 增强 Typora 菜单、偏好设置导航、工具栏按钮的点击反馈
 */

(function () {
    'use strict';

    if (window.__CRAB_ENHANCE_LOADED__) return;
    window.__CRAB_ENHANCE_LOADED__ = true;

    const SELECT_MARK = 'data-crab-enhanced';
    const states = new WeakMap();
    const observedRoots = new WeakSet();
    let openState = null;
    let scanQueued = false;
    let stateSyncQueued = false;

    const THEME_VARIABLES = [
        '--bg-color',
        '--text-color',
        '--element-color',
        '--primary-color',
        '--active-file-bg-color',
        '--item-hover-bg-color',
        '--control-text-color',
        '--window-border',
    ];

    const styleEl = document.createElement('style');
    styleEl.id = 'crab-enhance-styles';
    styleEl.textContent = `
        /* 原生 select 仍保留在 DOM 中，负责表单值与 React 事件；焦点和无障碍视图由 combobox 接管 */
        select[${SELECT_MARK}="true"] {
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            margin: -1px !important;
            padding: 0 !important;
            border: 0 !important;
            opacity: 0 !important;
            pointer-events: none !important;
            clip: rect(0 0 0 0) !important;
            clip-path: inset(50%) !important;
            overflow: hidden !important;
            white-space: nowrap !important;
        }

        .crab-select-wrapper {
            position: relative;
            display: inline-block;
            vertical-align: middle;
            min-width: 140px;
            box-sizing: border-box;
            font-family: inherit;
        }

        .crab-select-trigger {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            width: 100%;
            min-height: 32px;
            padding: 5px 12px;
            box-sizing: border-box;
            color: var(--text-color, #27272a);
            background: color-mix(in srgb, var(--bg-color, #fff) 96%, var(--text-color, #000) 4%);
            border: 1px solid transparent !important;
            border-radius: 6px !important;
            box-shadow:
                inset 0 0 0 1px color-mix(in srgb, var(--text-color, #000) 28%, transparent),
                0 1px 2px rgba(0, 0, 0, .06) !important;
            font: inherit;
            font-size: 13px;
            line-height: 1.5;
            text-align: left;
            cursor: pointer;
            outline: none;
            user-select: none;
            transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease, transform .1s ease;
        }

        .crab-select-trigger:hover {
            border-color: transparent !important;
            background: color-mix(in srgb, var(--bg-color, #fff) 91%, var(--text-color, #000) 9%);
            box-shadow:
                inset 0 0 0 1px color-mix(in srgb, var(--element-color, var(--primary-color, #71717a)) 58%, transparent),
                0 1px 2px rgba(0, 0, 0, .07) !important;
        }

        .crab-select-trigger:focus-visible,
        .crab-select-wrapper.open .crab-select-trigger {
            border-color: transparent !important;
            box-shadow:
                inset 0 0 0 2px color-mix(in srgb, var(--element-color, var(--primary-color, #3b82f6)) 78%, transparent),
                0 1px 2px rgba(0, 0, 0, .08) !important;
        }

        .crab-select-wrapper.disabled .crab-select-trigger {
            opacity: .55;
            cursor: not-allowed;
        }

        .crab-select-label {
            min-width: 0;
            flex: 1;
            overflow: hidden;
            color: inherit;
            white-space: nowrap;
            text-overflow: ellipsis;
            pointer-events: none;
        }

        .crab-select-arrow {
            display: inline-flex;
            flex: 0 0 14px;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            color: color-mix(in srgb, currentColor 68%, transparent);
            pointer-events: none;
            transition: transform .18s ease, color .18s ease;
        }

        .crab-select-wrapper.open .crab-select-arrow {
            color: var(--element-color, var(--primary-color, #3b82f6));
            transform: rotate(180deg);
        }

        .crab-select-dropdown {
            position: fixed;
            z-index: 2147483647;
            min-width: 140px;
            max-height: min(280px, calc(100vh - 20px));
            overflow-x: hidden;
            overflow-y: auto;
            margin: 0;
            padding: 4px;
            list-style: none;
            box-sizing: border-box;
            color: var(--text-color, #27272a);
            background-color: color-mix(in srgb, var(--bg-color, #fff) 95%, var(--text-color, #000) 5%);
            background-image: none;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
            border: 1px solid color-mix(in srgb, var(--text-color, #000) 24%, transparent);
            border-radius: 8px;
            box-shadow: 0 10px 24px rgba(0, 0, 0, .24), 0 2px 6px rgba(0, 0, 0, .12);
            isolation: isolate;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-5px) scale(.985);
            transform-origin: top center;
            transition: opacity .15s ease, transform .15s cubic-bezier(.16, 1, .3, 1), visibility .15s ease;
        }

        .crab-select-dropdown[data-placement="top"] {
            transform: translateY(5px) scale(.985);
            transform-origin: bottom center;
        }

        .crab-select-dropdown.open {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
        }

        .crab-select-option {
            display: flex;
            align-items: center;
            min-height: 30px;
            padding: 6px 10px;
            border-radius: 5px;
            color: inherit;
            font: inherit;
            font-size: 13px;
            line-height: 1.4;
            cursor: pointer;
            white-space: nowrap;
            transition: background-color .12s ease, color .12s ease, transform .1s ease;
        }

        .crab-select-option:hover,
        .crab-select-option[aria-selected="true"] {
            color: var(--element-color, var(--primary-color, #18181b));
            background: color-mix(in srgb, var(--element-color, var(--primary-color, #3b82f6)) 13%, transparent);
        }

        .crab-select-option[aria-selected="true"] {
            font-weight: 600;
        }

        .crab-select-option[aria-disabled="true"] {
            opacity: .45;
            cursor: not-allowed;
        }

        .crab-select-option:active {
            transform: scale(.97);
        }

        .crab-select-option-group {
            padding: 6px 10px 3px;
            color: color-mix(in srgb, currentColor 58%, transparent);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .03em;
            text-transform: uppercase;
        }

        .crab-select-dropdown::-webkit-scrollbar {
            width: 5px;
        }

        .crab-select-dropdown::-webkit-scrollbar-track {
            background: transparent;
        }

        .crab-select-dropdown::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, currentColor 22%, transparent);
            border-radius: 999px;
        }

        /* 候选词、补全、表情与代码提示 */
        .auto-suggest-container,
        .CodeMirror-hints,
        .ty-hint {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: color-mix(in srgb, var(--bg-color, #fff) 95%, var(--text-color, #000) 5%) !important;
            background-image: none !important;
            border: 1px solid color-mix(in srgb, var(--text-color, #000) 24%, transparent) !important;
            border-radius: 9px !important;
            box-shadow: 0 10px 24px rgba(0, 0, 0, .22), 0 2px 6px rgba(0, 0, 0, .1) !important;
            padding: 5px !important;
        }

        .auto-suggest-item,
        .CodeMirror-hint,
        .ty-hint-item {
            border-radius: 6px !important;
            padding: 6px 11px !important;
            transition: background-color .12s ease, color .12s ease, transform .1s ease !important;
        }

        .auto-suggest-item.active,
        .auto-suggest-item:hover,
        .CodeMirror-hint-active,
        .ty-hint-item:hover {
            color: var(--element-color, var(--primary-color, currentColor)) !important;
            background: color-mix(in srgb, var(--element-color, var(--primary-color, #3b82f6)) 14%, transparent) !important;
        }

        /* 菜单、偏好设置和工具栏的单项点击反馈 */
        .crab-interactive-item {
            transition: background-color .14s ease, color .14s ease, border-color .14s ease, transform .1s ease !important;
        }

        .crab-interactive-item:active {
            transform: scale(.97) !important;
        }

        .crab-toolbar-item:active,
        .crab-context-toolbar-item:active {
            transform: scale(.92) !important;
        }

        .crab-context-toolbar-item {
            position: relative;
            z-index: 1;
            border-radius: 6px !important;
        }

        .crab-context-toolbar-item:hover,
        .crab-context-toolbar-item.active {
            background: color-mix(in srgb, var(--element-color, var(--primary-color, #3b82f6)) 14%, transparent) !important;
        }
    `;
    (document.head || document.documentElement).appendChild(styleEl);

    const CARET_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    function isElement(value) {
        return value instanceof Element;
    }

    function getOptionText(option) {
        return (option?.textContent || option?.label || '').replace(/\s+/g, ' ').trim();
    }

    function setNativeValue(select, value, index) {
        const oldValue = select.value;
        const oldIndex = select.selectedIndex;

        try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
            if (descriptor?.set) descriptor.set.call(select, value);
            else select.value = value;
            if (typeof index === 'number' && select.selectedIndex !== index) {
                select.selectedIndex = index;
            }
        } catch (_) {
            select.value = value;
            if (typeof index === 'number') select.selectedIndex = index;
        }

        if (oldValue === select.value && oldIndex === select.selectedIndex) return false;

        // React 的 valueTracker 必须保留旧值，React 才会认为这是一次真实变化。
        try {
            const tracker = select._valueTracker;
            if (tracker) tracker.setValue(oldValue);
        } catch (_) {
            // 非 React 页面没有 tracker，忽略即可。
        }

        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function getState(select) {
        return states.get(select);
    }

    function scheduleStateSync() {
        if (stateSyncQueued) return;
        stateSyncQueued = true;
        requestAnimationFrame(() => {
            stateSyncQueued = false;
            queryAll(`select[${SELECT_MARK}="true"]`).forEach((select) => {
                const state = getState(select);
                if (state) {
                    updateDisabled(state);
                    updateSelection(state);
                }
            });
        });
    }

    function queueStateSyncForNode(node) {
        if (node instanceof HTMLSelectElement) {
            scheduleStateSync();
        } else if (typeof HTMLOptionElement !== 'undefined' && node instanceof HTMLOptionElement) {
            const select = node.closest('select');
            if (select) scheduleStateSync();
        }
    }

    function installNativeSelectHooks() {
        if (window.__CRAB_SELECT_HOOKS_INSTALLED__) return;
        window.__CRAB_SELECT_HOOKS_INSTALLED__ = true;

        const patch = (prototype, property, findSelect) => {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
            if (!descriptor?.set || !descriptor.get) return;
            try {
                Object.defineProperty(prototype, property, {
                    configurable: descriptor.configurable,
                    enumerable: descriptor.enumerable,
                    get: descriptor.get,
                    set(value) {
                        descriptor.set.call(this, value);
                        const select = findSelect(this);
                        if (select) scheduleStateSync();
                    },
                });
            } catch (_) {
                // 某些 Chromium/Typora 版本会锁定原型属性，保留原生实现继续运行。
            }
        };

        patch(HTMLSelectElement.prototype, 'value', (node) => node);
        patch(HTMLSelectElement.prototype, 'selectedIndex', (node) => node);
        if (typeof HTMLOptionElement !== 'undefined') {
            patch(HTMLOptionElement.prototype, 'selected', (node) => node.closest('select'));
        }
    }

    function syncThemeVariables(state) {
        const view = state.ownerDocument.defaultView || window;
        const computed = view.getComputedStyle(state.select);
        THEME_VARIABLES.forEach((name) => {
            const value = computed.getPropertyValue(name).trim();
            if (value) state.dropdown.style.setProperty(name, value);
            else state.dropdown.style.removeProperty(name);
        });
        const colorScheme = computed.getPropertyValue('color-scheme').trim();
        if (colorScheme) state.dropdown.style.colorScheme = colorScheme;
    }

    function closeDropdown(state) {
        if (!state) return;
        state.wrapper.classList.remove('open');
        state.dropdown.classList.remove('open');
        state.trigger.setAttribute('aria-expanded', 'false');
        state.trigger.removeAttribute('aria-activedescendant');
        if (state.dropdown.isConnected) state.dropdown.remove();
        if (openState === state) openState = null;
    }

    function closeAll(except) {
        if (openState && openState !== except) closeDropdown(openState);
    }

    function updateDisabled(state) {
        const disabled = state.select.disabled;
        state.wrapper.classList.toggle('disabled', disabled);
        state.trigger.disabled = disabled;
        state.trigger.setAttribute('aria-disabled', String(disabled));
    }

    function updateAccessibility(state) {
        const { select, trigger } = state;
        ['aria-label', 'aria-labelledby', 'aria-describedby'].forEach((attribute) => {
            const value = select.getAttribute(attribute);
            if (value) trigger.setAttribute(attribute, value);
            else trigger.removeAttribute(attribute);
        });
        if (!select.hasAttribute('aria-label') && !select.hasAttribute('aria-labelledby')) {
            const labelText = Array.from(select.labels || [])
                .map((label) => (label.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .join(' ');
            if (labelText) trigger.setAttribute('aria-label', labelText);
        }
        if (select.required || select.hasAttribute('aria-required')) trigger.setAttribute('aria-required', String(select.getAttribute('aria-required') || select.required));
        else trigger.removeAttribute('aria-required');
        if (select.hasAttribute('aria-invalid')) trigger.setAttribute('aria-invalid', select.getAttribute('aria-invalid') || 'true');
        else trigger.removeAttribute('aria-invalid');
        if (select.title) trigger.title = select.title;
        else trigger.removeAttribute('title');
    }

    function updateSelection(state) {
        const select = state.select;
        const selected = select.options[select.selectedIndex];
        const selectedText = selected ? getOptionText(selected) : '';
        state.label.textContent = selectedText;
        updateAccessibility(state);
        if (!state.trigger.hasAttribute('aria-label') && !state.trigger.hasAttribute('aria-labelledby')) {
            state.trigger.setAttribute('aria-label', selectedText || '选择项目');
        }

        let activeId = '';
        state.dropdown.querySelectorAll('.crab-select-option[data-index]').forEach((item) => {
            const selectedItem = Number(item.dataset.index) === select.selectedIndex;
            item.setAttribute('aria-selected', String(selectedItem));
            if (selectedItem) activeId = item.id;
        });
        if (state.wrapper.classList.contains('open') && activeId) state.trigger.setAttribute('aria-activedescendant', activeId);
        else state.trigger.removeAttribute('aria-activedescendant');
    }

    function buildOptions(state) {
        const { select, dropdown } = state;
        dropdown.replaceChildren();

        let optionIndex = 0;
        const appendOption = (option) => {
            const index = optionIndex++;
            const item = document.createElement('li');
            item.className = 'crab-select-option';
            item.setAttribute('role', 'option');
            item.id = `${dropdown.id}-option-${index}`;
            item.dataset.index = String(index);
            item.textContent = getOptionText(option);
            item.setAttribute('aria-selected', String(index === select.selectedIndex));
            item.setAttribute('aria-disabled', String(option.disabled));
            if (option.disabled) item.tabIndex = -1;

            item.addEventListener('pointerdown', (event) => event.preventDefault());
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                if (option.disabled) return;
                setNativeValue(select, option.value, index);
                updateSelection(state);
                closeDropdown(state);
                state.trigger.focus();
            });
            dropdown.appendChild(item);
        };

        Array.from(select.children).forEach((child) => {
            if (child.tagName === 'OPTGROUP') {
                const group = document.createElement('li');
                group.className = 'crab-select-option-group';
                group.setAttribute('role', 'presentation');
                group.textContent = child.label || '';
                dropdown.appendChild(group);
                Array.from(child.children).forEach((option) => appendOption(option));
            } else if (child.tagName === 'OPTION') {
                appendOption(child);
            }
        });

        updateSelection(state);
    }

    function positionDropdown(state) {
        if (!state.trigger.isConnected) {
            closeDropdown(state);
            return;
        }
        syncThemeVariables(state);
        const rect = state.trigger.getBoundingClientRect();
        const gap = 5;
        const viewportPadding = 8;
        const estimatedHeight = Math.min(280, Math.max(40, state.dropdown.scrollHeight || 280));
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
        const spaceAbove = rect.top - viewportPadding;
        const placeTop = spaceBelow < Math.min(240, estimatedHeight) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(80, Math.min(280, (placeTop ? spaceAbove : spaceBelow) - gap));
        const width = Math.min(
            Math.max(rect.width, state.dropdown.scrollWidth || 140),
            Math.max(40, window.innerWidth - viewportPadding * 2),
        );
        const left = Math.min(Math.max(viewportPadding, rect.left), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));

        state.dropdown.style.left = `${left}px`;
        state.dropdown.style.width = `${width}px`;
        state.dropdown.style.maxHeight = `${maxHeight}px`;
        state.dropdown.dataset.placement = placeTop ? 'top' : 'bottom';
        state.dropdown.style.top = placeTop ? 'auto' : `${rect.bottom + gap}px`;
        state.dropdown.style.bottom = placeTop ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    }

    function openDropdown(state) {
        if (state.select.disabled) return;
        closeAll(state);
        buildOptions(state);
        const body = state.ownerDocument.body || state.ownerDocument.documentElement;
        body.appendChild(state.dropdown);
        state.wrapper.classList.add('open');
        state.trigger.setAttribute('aria-expanded', 'true');
        updateSelection(state);
        openState = state;
        positionDropdown(state);
        requestAnimationFrame(() => state.dropdown.classList.add('open'));
    }

    function moveSelection(state, direction) {
        const options = Array.from(state.select.options);
        let index = state.select.selectedIndex;
        if (index < 0) index = direction > 0 ? -1 : options.length;
        do {
            index += direction;
        } while (index >= 0 && index < options.length && options[index].disabled);
        if (index >= 0 && index < options.length && !options[index].disabled) {
            setNativeValue(state.select, options[index].value, index);
            updateSelection(state);
        }
    }

    function selectBoundary(state, toEnd) {
        const options = Array.from(state.select.options);
        let index = toEnd ? options.length - 1 : 0;
        const direction = toEnd ? -1 : 1;
        while (index >= 0 && index < options.length && options[index].disabled) index += direction;
        if (index >= 0 && index < options.length) {
            setNativeValue(state.select, options[index].value, index);
            updateSelection(state);
        }
    }

    function enhanceSelect(select) {
        if (!select || select.getAttribute(SELECT_MARK) === 'true' || select.multiple) return;

        // 必须在增强标记触发隐藏样式前读取原生布局尺寸。
        const computed = getComputedStyle(select);
        const rect = select.getBoundingClientRect();
        const width = rect.width || parseFloat(computed.width) || 140;
        const height = rect.height || parseFloat(computed.height) || 32;
        const originalTabIndex = select.getAttribute('tabindex');
        const originalAriaHidden = select.getAttribute('aria-hidden');

        select.setAttribute(SELECT_MARK, 'true');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        const wrapper = document.createElement('div');
        wrapper.className = 'crab-select-wrapper';
        if (select.id) wrapper.id = `crab-wrapper-${select.id}`;

        wrapper.style.width = `${Math.max(40, width)}px`;
        wrapper.style.minHeight = `${Math.max(28, height)}px`;
        wrapper.style.margin = computed.margin;
        if (['block', 'inline-block', 'flex', 'inline-flex'].includes(computed.display)) {
            wrapper.style.display = computed.display;
        }

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'crab-select-trigger';
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const label = document.createElement('span');
        label.className = 'crab-select-label';
        const arrow = document.createElement('span');
        arrow.className = 'crab-select-arrow';
        arrow.innerHTML = CARET_SVG;
        trigger.append(label, arrow);

        const dropdown = document.createElement('ul');
        dropdown.className = 'crab-select-dropdown';
        dropdown.setAttribute('role', 'listbox');
        dropdown.id = `crab-listbox-${Math.random().toString(36).slice(2)}`;
        trigger.setAttribute('aria-controls', dropdown.id);

        const state = {
            select,
            wrapper,
            trigger,
            label,
            dropdown,
            ownerDocument: select.ownerDocument,
            originalTabIndex,
            originalAriaHidden,
            optionObserver: null,
            handleNativeFocus: null,
            typeahead: '',
            typeaheadTimer: null,
        };
        wrapper.__crabSelect = select;
        states.set(select, state);
        state.handleNativeFocus = () => trigger.focus();
        select.addEventListener('focus', state.handleNativeFocus);

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (wrapper.classList.contains('open')) closeDropdown(state);
            else openDropdown(state);
        });

        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (wrapper.classList.contains('open')) closeDropdown(state);
                else openDropdown(state);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeDropdown(state);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!wrapper.classList.contains('open')) openDropdown(state);
                moveSelection(state, 1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!wrapper.classList.contains('open')) openDropdown(state);
                moveSelection(state, -1);
            } else if (event.key === 'Home') {
                event.preventDefault();
                selectBoundary(state, false);
            } else if (event.key === 'End') {
                event.preventDefault();
                selectBoundary(state, true);
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
                state.typeahead += event.key.toLowerCase();
                clearTimeout(state.typeaheadTimer);
                state.typeaheadTimer = setTimeout(() => { state.typeahead = ''; }, 700);
                const match = Array.from(select.options).findIndex((option) =>
                    !option.disabled && getOptionText(option).toLowerCase().startsWith(state.typeahead)
                );
                if (match >= 0) {
                    setNativeValue(select, select.options[match].value, match);
                    updateSelection(state);
                }
            }
        });

        select.addEventListener('change', () => {
            updateDisabled(state);
            updateSelection(state);
        });

        state.optionObserver = new MutationObserver(() => {
            if (wrapper.classList.contains('open')) buildOptions(state);
            updateDisabled(state);
            updateSelection(state);
        });
        state.optionObserver.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'selected', 'value', 'required', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-required', 'aria-invalid', 'title'] });

        if (select.parentNode) {
            select.parentNode.insertBefore(wrapper, select.nextSibling);
            wrapper.appendChild(trigger);
        }

        buildOptions(state);
        updateDisabled(state);
    }

    function destroySelect(select) {
        const state = getState(select);
        if (!state) return;
        if (openState === state) closeDropdown(state);
        if (state.optionObserver) state.optionObserver.disconnect();
        if (state.handleNativeFocus) select.removeEventListener('focus', state.handleNativeFocus);
        clearTimeout(state.typeaheadTimer);
        if (state.wrapper.isConnected) state.wrapper.remove();
        select.removeAttribute(SELECT_MARK);
        if (state.originalTabIndex === null) select.removeAttribute('tabindex');
        else select.setAttribute('tabindex', state.originalTabIndex);
        if (state.originalAriaHidden === null) select.removeAttribute('aria-hidden');
        else select.setAttribute('aria-hidden', state.originalAriaHidden);
        states.delete(select);
    }

    function cleanupRemovedNode(node) {
        if (!(node instanceof Element)) return;
        if (node.matches(`select[${SELECT_MARK}="true"]`)) destroySelect(node);
        if (node.matches('.crab-select-wrapper') && node.__crabSelect) destroySelect(node.__crabSelect);
        node.querySelectorAll(`select[${SELECT_MARK}="true"]`).forEach(destroySelect);
        node.querySelectorAll('.crab-select-wrapper').forEach((wrapper) => {
            if (wrapper.__crabSelect) destroySelect(wrapper.__crabSelect);
        });
    }

    function collectShadowRoots(root, roots) {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('*').forEach((node) => {
            if (node.shadowRoot && !roots.includes(node.shadowRoot)) {
                roots.push(node.shadowRoot);
                collectShadowRoots(node.shadowRoot, roots);
            }
        });
    }

    function getScanRoots() {
        const roots = [document];
        collectShadowRoots(document, roots);
        return roots;
    }

    function queryAll(selector) {
        const seen = new Set();
        const result = [];
        getScanRoots().forEach((root) => {
            root.querySelectorAll(selector).forEach((node) => {
                if (!seen.has(node)) {
                    seen.add(node);
                    result.push(node);
                }
            });
        });
        return result;
    }

    function observeShadowRoots(root) {
        const roots = [];
        collectShadowRoots(root, roots);
        roots.forEach((shadowRoot) => {
            if (observedRoots.has(shadowRoot)) return;
            observedRoots.add(shadowRoot);
            new MutationObserver(handleMutations).observe(shadowRoot, { childList: true, subtree: true, attributes: true });
        });
    }

    function markInteractiveItems() {
        const selectors = [
            '.nav-group-item',
            '.context-menu .menu-item',
            '.dropdown-menu li > a',
            '.megamenu-menu-list li a',
            '.sidebar-menu-item',
            '.toolbar-icon',
            '.md-toolbar-item',
            '.context-menu .btn',
            '.context-menu .btn-group .btn',
        ];
        queryAll(selectors.join(',')).forEach((item) => {
            if (item.dataset.crabInteractive === 'true') return;
            item.dataset.crabInteractive = 'true';
            item.classList.add('crab-interactive-item');
            if (item.closest('.context-menu') && item.matches('.btn, .btn-group .btn')) {
                item.classList.add('crab-context-toolbar-item');
            } else if (item.matches('.toolbar-icon, .md-toolbar-item')) {
                item.classList.add('crab-toolbar-item');
            }
        });
    }

    function handleMutations(mutations) {
        let needsScan = false;
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                needsScan = true;
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) observeShadowRoots(node);
                });
                mutation.removedNodes.forEach(cleanupRemovedNode);
            } else if (mutation.type === 'attributes' && (
                mutation.target instanceof HTMLSelectElement ||
                (typeof HTMLOptionElement !== 'undefined' && mutation.target instanceof HTMLOptionElement)
            )) {
                queueStateSyncForNode(mutation.target);
            }
        });
        if (needsScan) scheduleScan();
    }

    function scanAndEnhance() {
        scanQueued = false;
        observeShadowRoots(document);
        queryAll(`select:not([${SELECT_MARK}="true"])`).forEach(enhanceSelect);
        markInteractiveItems();
    }

    function scheduleScan() {
        if (scanQueued) return;
        scanQueued = true;
        requestAnimationFrame(scanAndEnhance);
    }

    document.addEventListener('pointerdown', (event) => {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        const insideSelect = path.some((node) => isElement(node) && node.matches('.crab-select-wrapper, .crab-select-dropdown, .crab-select-wrapper *'));
        if (!insideSelect) closeAll();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAll();
    }, true);

    window.addEventListener('resize', () => {
        if (openState) positionDropdown(openState);
    }, { passive: true });
    window.addEventListener('scroll', () => {
        if (openState) positionDropdown(openState);
    }, { passive: true, capture: true });

    document.addEventListener('reset', () => {
        requestAnimationFrame(() => {
            queryAll(`select[${SELECT_MARK}="true"]`).forEach((select) => {
                const state = getState(select);
                if (state) updateSelection(state);
            });
        });
    }, true);

    const observer = new MutationObserver(handleMutations);
    const start = () => {
        installNativeSelectHooks();
        scanAndEnhance();
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'label', 'selected', 'value', 'required', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-required', 'aria-invalid', 'title'],
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    console.log('[Crab Theme] Native DOM enhancement engine initialized.');
})();
