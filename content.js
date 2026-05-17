(function () {
  'use strict';

  const EXPORT_ROOT_ID = 'qwen-pdf-export-root';
  const EXPORT_BODY_ID = 'qwen-pdf-export-body';
  const EXPORT_DOC_CLASS = 'qwen-pdf-doc';
  const EXPORT_PAGE_WIDTH_PX = 1123;
  const EXPORT_CONTENT_MAX_PX = 1040;
  const EXPORT_PAGE_CONTENT_HEIGHT_PX = 680;
  const EXPORT_VERSION = '1.0.0';
  const OVERLAY_ROOT_ID = 'qwen-pdf-overlay-root';
  const EXPORT_SPLASH_ID = 'qwen-pdf-export-splash';
  const SCROLL_PAUSE_MS = 80;
  const MAX_SCROLL_STEPS = 12;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true, version: EXPORT_VERSION });
      return false;
    }

    if (message?.type === 'EXPORT_PDF') {
      handleExport(message.options || {})
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({
            success: false,
            error: err?.message || String(err),
          })
        );
      return true;
    }

    return false;
  });

  const CHAT_CONTAINER_SELECTORS = [
    '#chat-container',
    '.main-content',
    '.layout-main',
    '.chat-container',
    '[class*="chat-message-list"]',
    '[class*="message-list"]',
    '[class*="conversation-scroll"]',
    '[class*="chat-scroll"]',
    'main',
  ];

  const MESSAGE_BLOCK_SELECTORS = [
    '[data-message-author-role]',
    '[data-role="user"]',
    '[data-role="assistant"]',
    '[data-role="model"]',
    '[data-message-role]',
    '[data-testid*="message"]',
    '[data-testid*="conversation-turn"]',
    '.chat-message-item',
    '[class*="chat-message-item"]',
    '[class*="message-item"]:not([class*="input"])',
    '[class*="conversation-turn"]',
    '[class*="chat-turn"]',
    '[class*="dialogue-item"]',
    '[class*="chat-item"]:not([class*="input"]):not([class*="recommend"])',
    '[class*="message-row"]',
    '[class*="message-block"]',
    '[class*="message-bubble"]',
    '[class*="chat-bubble"]',
    '[class*="user-message"]',
    '[class*="assistant-message"]',
    '[class*="human-message"]',
    '[class*="bot-message"]',
    '[class*="question-item"]',
    '[class*="answer-item"]',
    '[class*="query-item"]',
    '[class*="response-item"]',
  ];

  const CONTENT_SELECTORS = [
    '.markdown-prose',
    '.markdown-body',
    '.prose',
    '[class*="markdown-prose"]',
    '[class*="markdown-body"]',
    '[class*="qwen-markdown"]',
    '[class*="markdown-content"]',
    '[class*="message-content"]',
    '[class*="chat-content"]',
    '[class*="answer-content"]',
    '[class*="response-content"]',
    '[class*="prose"]',
  ];

  const MARKDOWN_LEAF_SELECTORS = [
    '.markdown-prose',
    '[class*="markdown-prose"]',
    '[class*="qwen-markdown"]',
    '.markdown-body',
    '[class*="markdown-body"]',
    '[class*="markdown-render"]',
    '[class*="markdown_content"]',
  ];

  const TITLE_SELECTORS = [
    'header h1',
    '.header-desktop h1',
    '[class*="chat-title"]',
    '[class*="conversation-title"]',
    'title',
  ];

  const SIDEBAR_SELECTORS = [
    'aside',
    'nav',
    '[class*="sidebar"]',
    '[class*="side-bar"]',
    '[class*="sider"]',
    '[class*="chat-list"]',
    '[class*="conversation-list"]',
    '[class*="history-list"]',
    '[class*="session-list"]',
    '[class*="chat-history"]',
    '[class*="chat-recommend"]',
    '[class*="recent-chat"]',
    '[class*="chat-menu"]',
  ];

  const UI_ANCESTOR_SELECTORS = [
    'nav',
    'aside',
    'footer',
    'header.header-desktop',
    '.chat-message-input-container',
    '.chat-message-input-all',
    '.chat-layout-input-container',
    '.prompt-input-action-bar',
    '.chat-prompt-suggest-button-group',
    '.chat-recommend-txt',
    '.chat-recommend-txt-container',
    '.chat-container-statement',
    '.qwen-chat-layout-help',
    '.show-shortcuts-button',
    '#chat-input',
    '[id="chat-input"]',
    '[class*="text-area-box"]',
    '[class*="input-container"]',
    'script',
    'style',
    ...SIDEBAR_SELECTORS,
  ];

  const NAV_LABEL_PATTERNS = [
    /^new chat$/i,
    /^community$/i,
    /^projects$/i,
    /^all chats$/i,
    /^yesterday$/i,
    /^new project$/i,
    /^thought completed$/i,
    /^previous \d+ days$/i,
    /^previous \d+ weeks$/i,
    /^qwen$/i,
    /^auto$/i,
    /^where to begin\.?$/i,
  ];

  const STRIP_FROM_CLONE_SELECTORS = [
    'button',
    'input',
    'textarea',
    '[contenteditable="true"]',
    'canvas',
    ...UI_ANCESTOR_SELECTORS,
  ].join(', ');

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInSidebar(el) {
    for (const sel of SIDEBAR_SELECTORS) {
      try {
        if (el.closest(sel)) return true;
      } catch {}
    }
    return false;
  }

  function isInMainChatColumn(el) {
    if (!(el instanceof HTMLElement) || isInSidebar(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const minLeft = Math.min(300, window.innerWidth * 0.28);
    return rect.left >= minLeft;
  }

  function isNavigationLabel(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120) return false;
    return NAV_LABEL_PATTERNS.some((re) => re.test(t));
  }

  function isUiChrome(el) {
    if (!(el instanceof Element)) return true;
    if (el.closest(`#${OVERLAY_ROOT_ID}, #${EXPORT_SPLASH_ID}, [data-qwen-pdf-ui]`)) return true;
    if (isInSidebar(el)) return true;
    if (el.matches('button, input, textarea, select, label, nav, aside, footer')) return true;
    if (el.closest('#chat-input, [contenteditable="true"]')) return true;
    for (const sel of UI_ANCESTOR_SELECTORS) {
      try {
        if (el.closest(sel)) return true;
      } catch {
      }
    }
    const cls = (el.className || '').toString().toLowerCase();
    if (
      cls.includes('recommend') ||
      cls.includes('shortcut') ||
      cls.includes('input-box') ||
      cls.includes('text-area-box')
    ) {
      return true;
    }
    return false;
  }

  function hasSubstantiveContent(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 2) return true;
    return !!el.querySelector('img, pre, code, table, ul, ol, h1, h2, h3, p');
  }

  function* walkElements(root) {
    const start =
      root instanceof Document ? root.documentElement : /** @type {Element} */ (root);
    if (!start) return;

    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      if (!(node instanceof Element)) continue;
      yield node;
      if (node.shadowRoot) stack.push(...node.shadowRoot.children);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  function queryAllDeep(selector, root = document) {
    const results = [];
    const base = root instanceof Document ? root.documentElement : root;
    if (!base) return results;

    for (const el of walkElements(base)) {
      try {
        if (el.matches(selector)) results.push(el);
      } catch {
      }
    }
    return results;
  }

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
      }
    }
    return null;
  }

  function findChatContainer() {
    const direct = queryFirst(CHAT_CONTAINER_SELECTORS);
    if (direct) return direct;

    for (const sel of MARKDOWN_LEAF_SELECTORS) {
      const nodes = queryAllDeep(sel);
      if (nodes.length) {
        let parent = nodes[0].parentElement;
        while (parent && parent !== document.body) {
          const siblings = queryAllDeep(sel, parent);
          if (siblings.length >= 2) return parent;
          parent = parent.parentElement;
        }
      }
    }

    return document.querySelector('main') || document.body;
  }

  function getCommonAncestor(a, b) {
    const seen = new Set();
    let node = a;
    while (node) {
      seen.add(node);
      node = node.parentElement;
    }
    node = b;
    while (node) {
      if (seen.has(node)) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  function getActiveConversationRoot() {
    const markdownInChat = queryAllDeep(MARKDOWN_LEAF_SELECTORS.join(', ')).filter(
      (el) => isVisible(el) && isInMainChatColumn(el) && !isUiChrome(el)
    );

    if (markdownInChat.length) {
      let root = markdownInChat[0];
      for (let i = 1; i < Math.min(markdownInChat.length, 40); i++) {
        root = getCommonAncestor(root, markdownInChat[i]);
      }
      if (root && isInMainChatColumn(root)) return root;
    }

    for (const sel of ['#chat-container', '.main-content', '.layout-main', 'main']) {
      const el = document.querySelector(sel);
      if (!el || isInSidebar(el)) continue;
      if (el.querySelector(MARKDOWN_LEAF_SELECTORS.join(', '))) return el;
    }

    const main = document.querySelector('.main-content') || document.querySelector('main');
    if (main) {
      for (const child of main.children) {
        if (
          child instanceof Element &&
          !isInSidebar(child) &&
          child.querySelector(MARKDOWN_LEAF_SELECTORS.join(', '))
        ) {
          return child;
        }
      }
    }

    return document.querySelector('#chat-container') || document.querySelector('main') || document.body;
  }

  function isValidMessageCandidate(el) {
    if (!isVisible(el) || isUiChrome(el)) return false;
    if (!hasSubstantiveContent(el)) return false;
    return true;
  }

  function collectBySelectors(root, selectors) {
    const found = new Set();
    for (const sel of selectors) {
      try {
        queryAllDeep(sel, root).forEach((el) => {
          if (isValidMessageCandidate(el)) found.add(el);
        });
      } catch {}
    }
    return [...found];
  }

  function dedupeToOutermost(elements) {
    return elements.filter(
      (el) => !elements.some((other) => other !== el && el.contains(other))
    );
  }

  function collectMarkdownBlocks(root) {
    const blocks = collectBySelectors(root, MARKDOWN_LEAF_SELECTORS).filter(
      (el) => !isInSidebar(el)
    );
    return dedupeToOutermost(blocks.filter(isValidMessageCandidate));
  }

  function collectUserPromptBlocks(root) {
    const userSelectors = [
      '[class*="user-message"]',
      '[class*="user_message"]',
      '[class*="human-message"]',
      '[class*="question-content"]',
      '[class*="query-content"]',
      '[class*="prompt-content"]',
      '[class*="user-content"]',
      '[class*="user-query"]',
      '[class*="chat-question"]',
      '[data-role="user"]',
      '[data-message-author-role="user"]',
    ];
    const found = collectBySelectors(root, userSelectors);
    return dedupeNestedMessages(
      found.filter((el) => {
        if (el.querySelector(MARKDOWN_LEAF_SELECTORS.join(', '))) return false;
        return isValidMessageCandidate(el);
      })
    );
  }

  function collectByRepeatingSiblings(root) {
    const candidates = [];
    for (const el of walkElements(root)) {
      if (isUiChrome(el) || !isVisible(el)) continue;
      const parent = el.parentElement;
      if (!parent || parent.children.length < 2) continue;

      const richChildren = [...parent.children].filter(
        (child) =>
          child instanceof Element &&
          isVisible(child) &&
          !isUiChrome(child) &&
          hasSubstantiveContent(child)
      );

      if (richChildren.length < 2) continue;

      const classNames = richChildren.map((c) => (c.className || '').toString());
      const hasSharedPattern = classNames.some(
        (cn) =>
          cn.length > 3 &&
          classNames.filter((other) => other === cn || (cn && other.includes(cn.slice(0, 12))))
            .length >= 2
      );

      if (hasSharedPattern || richChildren.length >= 3) {
        richChildren.forEach((c) => candidates.push(c));
      }
    }

    return dedupeNestedMessages([...new Set(candidates)].filter(isValidMessageCandidate));
  }

  function collectStructuralMessages() {
    const column =
      document.querySelector('.main-content') ||
      document.querySelector('#chat-container') ||
      document.querySelector('.layout-main') ||
      document.querySelector('main');
    if (!column) return [];

    const items = [];

    for (const el of walkElements(column)) {
      if (!(el instanceof HTMLElement) || isUiChrome(el) || !isVisible(el)) continue;

      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 12) continue;

      const richChildren = [...el.children].filter(
        (c) =>
          c instanceof HTMLElement &&
          (c.innerText || '').replace(/\s+/g, ' ').trim().length >= 12
      );
      if (richChildren.length >= 4) continue;

      const hasBlock =
        el.matches('p, pre, article, section, blockquote, h1, h2, h3, li') ||
        el.querySelector(':scope > p, :scope > pre, :scope > ul, :scope > ol, :scope > table');

      const isTextDiv =
        (el.tagName === 'DIV' || el.tagName === 'SPAN') &&
        !el.querySelector('button, input, textarea, nav, aside') &&
        (hasBlock || text.length >= 18);

      if (isTextDiv) items.push(el);
    }

    return dedupeNestedMessages(items.filter(isValidMessageCandidate));
  }

  function collectRichBlocksHeuristic() {
    const main =
      document.querySelector('.main-content') ||
      document.querySelector('main') ||
      document.body;
    const blocks = [];

    for (const el of walkElements(main)) {
      if (isUiChrome(el) || !isVisible(el)) continue;
      const hasRich =
        el.matches('p, pre, li, h1, h2, h3, table') ||
        el.querySelector('p, pre, table, ul, ol');
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!hasRich && text.length < 24) continue;
      if (text.length < 8 && !el.querySelector('pre, table, img')) continue;

      const cls = (el.className || '').toString().toLowerCase();
      if (
        cls.includes('markdown') ||
        cls.includes('message') ||
        cls.includes('prose') ||
        cls.includes('bubble') ||
        cls.includes('content') ||
        cls.includes('answer') ||
        cls.includes('query') ||
        cls.includes('response') ||
        cls.includes('qwen')
      ) {
        blocks.push(el);
      }
    }

    return dedupeNestedMessages(blocks.filter(isValidMessageCandidate));
  }

  function collectOrphanTextBubbles(root) {
    const markdownSet = new Set(collectMarkdownBlocks(root));
    const items = [];

    for (const el of walkElements(root)) {
      if (!(el instanceof HTMLElement) || isUiChrome(el) || markdownSet.has(el)) continue;
      if (el.closest(MARKDOWN_LEAF_SELECTORS.join(', '))) continue;

      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 8 || text.length > 80000) continue;

      const hasMarkdownChild = el.querySelector(MARKDOWN_LEAF_SELECTORS.join(', '));
      if (hasMarkdownChild) continue;

      if (el.tagName !== 'DIV' && el.tagName !== 'P' && el.tagName !== 'SPAN') continue;

      const childWithMoreText = [...el.children].some(
        (c) => c instanceof HTMLElement && (c.innerText || '').trim().length >= text.length * 0.85
      );
      if (childWithMoreText && el.children.length > 0) continue;

      items.push(el);
    }

    return dedupeNestedMessages(items.filter(isValidMessageCandidate));
  }

  function collectTurnWrappers(root) {
    const turnSelectors = [
      '[data-message-author-role]',
      '[data-role="user"]',
      '[data-role="assistant"]',
      '[data-testid*="conversation-turn"]',
      '[class*="conversation-turn"]',
      '[class*="chat-turn"]',
      '[class*="message-turn"]',
      '[class*="dialogue-turn"]',
    ];
    return dedupeToOutermost(
      collectBySelectors(root, turnSelectors).filter((el) => !isInSidebar(el))
    );
  }

  function dedupeByTextContent(elements) {
    const seen = new Set();
    return elements.filter((el) => {
      const key = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isLikelyAssistantBlock(el) {
    if (el.matches(MARKDOWN_LEAF_SELECTORS.join(', '))) return true;
    const cls = (el.className || '').toString().toLowerCase();
    return (
      cls.includes('markdown') ||
      cls.includes('assistant') ||
      cls.includes('answer') ||
      cls.includes('response') ||
      cls.includes('qwen-markdown')
    );
  }

  function isTurnWrapper(el) {
    for (const sel of MESSAGE_BLOCK_SELECTORS) {
      try {
        if (el.matches(sel)) return true;
      } catch {
      }
    }
    return false;
  }

  function filterMessageCandidates(list) {
    return list.filter((el) => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (isNavigationLabel(text)) return false;
      if (text.length < 3) return false;
      return isValidMessageCandidate(el);
    });
  }

  function findMessageElements(_container) {
    const root = getActiveConversationRoot();

    const markdownAll = queryAllDeep(MARKDOWN_LEAF_SELECTORS.join(', '), root).filter(
      (el) => isValidMessageCandidate(el) && isInMainChatColumn(el)
    );
    const outerMarkdown = markdownAll.filter(
      (el) => !markdownAll.some((other) => other !== el && other.contains(el))
    );

    const users = collectUserPromptBlocks(root).filter(
      (el) => isValidMessageCandidate(el) && isInMainChatColumn(el)
    );
    const outerUsers = users.filter(
      (el) => !users.some((other) => other !== el && other.contains(el))
    );

    let list = filterMessageCandidates(dedupeToOutermost([...outerUsers, ...outerMarkdown]));

    if (list.length < 2) {
      const turns = filterMessageCandidates(
        collectTurnWrappers(root).filter((el) => isInMainChatColumn(el))
      );
      if (turns.length >= 2) list = dedupeToOutermost(turns);
    }

    return sortByDocumentOrder(dedupeByTextContent(list));
  }

  function mergeConsecutiveSameRole(messages) {
    const merged = [];
    for (const msg of messages) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === msg.role) {
        prev.text = `${prev.text}\n\n${msg.text}`;
        prev.html = `${prev.html}<hr class="msg-merge-sep" />${msg.html}`;
      } else {
        merged.push({
          role: msg.role,
          text: msg.text,
          html: msg.html,
          index: merged.length,
        });
      }
    }
    merged.forEach((m, i) => {
      m.index = i;
    });
    return merged;
  }

  function dedupeNestedMessages(elements) {
    return elements.filter(
      (el) => !elements.some((other) => other !== el && el.contains(other))
    );
  }

  function sortByDocumentOrder(elements) {
    return elements.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function detectRole(el) {
    if (isLikelyAssistantBlock(el)) return 'assistant';

    const attrs = [
      el.getAttribute('data-message-author-role'),
      el.getAttribute('data-role'),
      el.getAttribute('data-message-role'),
    ].filter(Boolean);

    for (const val of attrs) {
      const lower = val.toLowerCase();
      if (lower.includes('user') || lower === 'human') return 'user';
      if (lower.includes('assistant') || lower.includes('bot') || lower === 'model')
        return 'assistant';
    }

    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('user') || cls.includes('human') || cls.includes('prompt'))
      return 'user';
    if (
      cls.includes('assistant') ||
      cls.includes('response') ||
      cls.includes('answer') ||
      cls.includes('bot') ||
      cls.includes('markdown') ||
      cls.includes('qwen-markdown')
    )
      return 'assistant';

    const label = el.querySelector('[class*="role"], [class*="author"], [class*="sender"]');
    if (label) {
      const t = (label.textContent || '').toLowerCase();
      if (t.includes('you') || t.includes('user')) return 'user';
      if (t.includes('qwen') || t.includes('assistant')) return 'assistant';
    }

    return 'unknown';
  }

  function extractContentNode(messageEl) {
    for (const sel of CONTENT_SELECTORS) {
      try {
        const node = messageEl.matches(sel)
          ? messageEl
          : messageEl.querySelector(sel);
        if (node && hasSubstantiveContent(node)) {
          return /** @type {HTMLElement} */ (node);
        }
      } catch {}
    }

    if (hasSubstantiveContent(messageEl)) {
      return /** @type {HTMLElement} */ (messageEl);
    }

    const textChild = [...messageEl.querySelectorAll('div, p, span')]
      .filter((n) => isVisible(n) && !isUiChrome(n) && hasSubstantiveContent(n))
      .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];

    return textChild ? /** @type {HTMLElement} */ (textChild) : null;
  }

  function getChatTitle() {
    const skipTitles = /^(qwen|qwen studio|new chat|chat)$/i;

    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel);
      const text = (el?.textContent || '').trim();
      if (text && text.length > 1 && !skipTitles.test(text)) return text;
    }

    const mainTitle = document.querySelector(
      'main [class*="title"], main h1, [class*="chat-header"] h1, [class*="conversation-title"]'
    );
    const mainText = (mainTitle?.textContent || '').trim();
    if (mainText && mainText.length > 1 && !skipTitles.test(mainText)) return mainText;

    const title = document.title.replace(/\s*[-|]\s*Qwen.*$/i, '').trim();
    if (title && title.length > 1 && !skipTitles.test(title)) return title;

    return 'Qwen Chat Conversation';
  }

  function sanitizeFilename(title) {
    const base =
      title
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'qwen-chat';

    const stamp = new Date().toISOString().slice(0, 10);
    return `${base} - ${stamp} - v${EXPORT_VERSION}.pdf`;
  }

  async function autoScrollChat(container, enabled) {
    if (!enabled) return;

    const scrollTarget =
      findScrollableParent(container) ||
      findScrollableParent(document.querySelector('.main-content')) ||
      findScrollableParent(document.querySelector('#chat-container')) ||
      findScrollableParent(document.querySelector('main'));

    if (!scrollTarget) {
      const startY = window.scrollY;
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(SCROLL_PAUSE_MS);
      for (let i = 0; i < 40; i++) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        await sleep(SCROLL_PAUSE_MS);
      }
      window.scrollTo({ top: startY, behavior: 'instant' });
      await sleep(200);
      return;
    }

    const el = /** @type {HTMLElement} */ (scrollTarget);
    const startTop = el.scrollTop;

    let lastBlockCount = -1;
    let stableCount = 0;

    for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
      el.scrollTop = 0;
      await sleep(SCROLL_PAUSE_MS);
      el.scrollTop = el.scrollHeight;
      await sleep(SCROLL_PAUSE_MS);

      const blockCount = queryAllDeep(MARKDOWN_LEAF_SELECTORS.join(', '), el).filter(
        (n) => !isInSidebar(n)
      ).length;
      if (blockCount === lastBlockCount) {
        stableCount++;
        if (stableCount >= 2) break;
      } else {
        stableCount = 0;
        lastBlockCount = blockCount;
      }
    }

    el.scrollTop = startTop;
    await sleep(300);
  }

  function findScrollableParent(el) {
    let node = el;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(/** @type {Element} */ (node));
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        /** @type {HTMLElement} */ (node).scrollHeight >
          /** @type {HTMLElement} */ (node).clientHeight
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function messageHasTableLikeContent(root) {
    if (!(root instanceof HTMLElement)) return false;
    if (root.querySelector('table, [role="table"], .pdf-export-table')) return true;

    return [...root.querySelectorAll('[class*="table"], [class*="Table"]')].some((el) => {
      if (!(el instanceof HTMLElement) || el.tagName === 'TABLE') return false;
      const cls = (el.className || '').toString().toLowerCase();
      return /markdown-table|data-table|probability|distribution|tabular/.test(cls);
    });
  }

  function isTableWrapperElement(el) {
    if (!(el instanceof HTMLElement) || el.tagName === 'TABLE') return false;
    const cls = (el.className || '').toString().toLowerCase();
    return /markdown-table|data-table|pdf-export|tabular|table-wrapper|table-container/.test(
      cls
    );
  }

  function extractRowCellHtml(rowEl) {
    const kids = [...rowEl.children].filter((c) => c instanceof HTMLElement);
    if (kids.length >= 2) {
      return kids.map((k) => {
        const html = k.innerHTML.trim();
        return html || escapeHtml((k.innerText || '').trim());
      });
    }

    const nested = rowEl.querySelectorAll(
      '[role="cell"], [role="columnheader"], [role="rowheader"], td, th, [class*="cell"], [class*="col"]'
    );
    if (nested.length >= 2) {
      return [...nested].map((c) => {
        const html = c.innerHTML.trim();
        return html || escapeHtml((c.innerText || '').trim());
      });
    }

    return [];
  }

  function isLikelyTableRow(el) {
    const cells = extractRowCellHtml(el);
    if (cells.length < 2 || cells.length > 14) return false;
    return cells.every((c) => {
      const plain = c.replace(/<[^>]+>/g, '').trim();
      return plain.length <= 24;
    });
  }

  function tryExtractTableMatrix(parent, view = window) {
    if (parent.closest('table, .katex, pre, code')) return null;
    if ((parent.innerText || '').length > 2500) return null;

    const getStyle = (el) => {
      const w = view?.getComputedStyle ? view : view?.defaultView || window;
      return w.getComputedStyle(el);
    };

    if (parent.tagName === 'TABLE') {
      const matrix = [...parent.rows]
        .map((row) => [...row.cells].map((c) => c.innerHTML.trim() || escapeHtml(c.innerText.trim())))
        .filter((row) => row.length);
      return matrix.length >= 2 ? matrix : null;
    }

    const roleRows = parent.matches('[role="table"]')
      ? [...parent.querySelectorAll('[role="row"]')]
      : [];
    if (roleRows.length >= 2) {
      const matrix = roleRows
        .map((row) => extractRowCellHtml(/** @type {HTMLElement} */ (row)))
        .filter((row) => row.length);
      if (matrix.length >= 2 && matrix[0] && matrix.every((r) => r.length === matrix[0].length)) {
        return matrix;
      }
    }

    const rowEls = [...parent.children].filter(
      (c) => c instanceof HTMLElement && isLikelyTableRow(c)
    );
    if (rowEls.length >= 2 && rowEls.length <= 8) {
      const matrix = rowEls
        .map((r) => extractRowCellHtml(r))
        .filter((row) => row.length >= 2);
      if (matrix.length >= 2 && matrix[0]) {
        const cols = matrix[0].length;
        if (cols >= 2 && matrix.every((r) => r.length === cols)) return matrix;
      }
    }

    const cs = getStyle(parent);
    if (cs.display === 'grid' && parent.children.length >= 4) {
      const cols = parseGridColumnCount(cs.gridTemplateColumns, parent);
      if (cols >= 2 && parent.children.length % cols === 0) {
        const cells = [...parent.children].map((c) =>
          c instanceof HTMLElement
            ? c.innerHTML.trim() || escapeHtml((c.innerText || '').trim())
            : ''
        );
        const matrix = [];
        for (let i = 0; i < cells.length; i += cols) {
          matrix.push(cells.slice(i, i + cols));
        }
        if (matrix.length >= 2) return matrix;
      }
    }

    return null;
  }

  function buildTableFromMatrix(matrix) {
    const safeRows = (matrix || []).filter((row) => Array.isArray(row) && row.length);
    if (safeRows.length < 1) {
      const empty = document.createElement('table');
      empty.className = 'pdf-export-table';
      return empty;
    }

    const table = document.createElement('table');
    table.className = 'pdf-export-table';

    safeRows.forEach((row, rowIdx) => {
      const tr = document.createElement('tr');
      row.forEach((cellHtml) => {
        const cell = document.createElement(rowIdx === 0 ? 'th' : 'td');
        cell.innerHTML = cellHtml;
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });

    enhanceHtmlTable(table);
    return table;
  }

  function collectTableRegions(root) {
    const candidates = [];
    const seen = new Set();
    const view = root.ownerDocument?.defaultView || window;

    const consider = (el) => {
      if (!(el instanceof HTMLElement) || seen.has(el)) return;
      const matrix = tryExtractTableMatrix(el, view);
      if (!matrix) return;
      seen.add(el);
      candidates.push({ el, rows: matrix });
    };

    root.querySelectorAll('table, [role="table"]').forEach(consider);

    root.querySelectorAll('[class*="table"], [class*="Table"]').forEach((el) => {
      if (el instanceof HTMLElement && el.tagName !== 'TABLE') consider(el);
    });

    for (const child of root.children) {
      if (!(child instanceof HTMLElement)) continue;
      const cs = view.getComputedStyle(child);
      if (cs.display === 'grid' && child.children.length >= 4) consider(child);
    }

    return candidates
      .filter(
        (c, _i, arr) =>
          !arr.some((other) => other.el !== c.el && other.el.contains(c.el))
      )
      .map((c, i) => {
        const id = `qtable-${i}`;
        c.el.setAttribute('data-qwen-pdf-table-id', id);
        return { id, el: c.el, rows: c.rows };
      });
  }

  function applyTableRegionsToClone(clone, regions) {
    const view = clone.ownerDocument?.defaultView || window;

    regions.forEach(({ id, rows }) => {
      const target = clone.querySelector(`[data-qwen-pdf-table-id="${id}"]`);
      if (target) target.replaceWith(buildTableFromMatrix(rows));
    });

    clone.querySelectorAll('[data-qwen-pdf-table-id]').forEach((n) => {
      n.removeAttribute('data-qwen-pdf-table-id');
    });

    clone.querySelectorAll('[class*="table"], [class*="Table"]').forEach((wrapper) => {
      if (!isTableWrapperElement(wrapper)) return;
      const innerTable = wrapper.querySelector('table.pdf-export-table, table');
      if (innerTable) {
        wrapper.replaceWith(innerTable);
        return;
      }
      if (wrapper.querySelector('table')) return;
      try {
        const matrix = tryExtractTableMatrix(wrapper, view);
        if (matrix && matrix.length >= 2) wrapper.replaceWith(buildTableFromMatrix(matrix));
      } catch (err) {
        console.warn('[Qwen PDF] Clone table conversion failed:', err);
      }
    });
  }

  function enhanceCloneTables(source, clone, tableRegions) {
    try {
      applyTableRegionsToClone(clone, tableRegions || []);

      const needsTablePass =
        tableRegions.length > 0 || messageHasTableLikeContent(source) || messageHasTableLikeContent(clone);
      if (!needsTablePass) return;

      enhanceTablesFromOriginal(source, clone);
      convertAriaTables(clone);
      repairStackedTables(clone);
      convertStackedParagraphsToTable(clone);
      mergeAdjacentSingleRowTables(clone);
    } catch (err) {
      console.warn('[Qwen PDF] Table enhancement skipped:', err);
    }
  }

  function rebuildTablesInExportDoc(doc) {
    const bodies = doc.querySelectorAll('.message-body');
    bodies.forEach((body) => {
      if (!(body instanceof HTMLElement)) return;

      let regions = [];
      try {
        regions = collectTableRegions(body);
      } catch (err) {
        console.warn('[Qwen PDF] Table region scan failed:', err);
        return;
      }
      regions.forEach((r) => {
        const target = body.querySelector(`[data-qwen-pdf-table-id="${r.id}"]`);
        if (target) target.replaceWith(buildTableFromMatrix(r.rows));
        r.el.removeAttribute('data-qwen-pdf-table-id');
      });

      body.querySelectorAll('[data-qwen-pdf-table-id]').forEach((n) => {
        n.removeAttribute('data-qwen-pdf-table-id');
      });

      [...body.querySelectorAll('div, section, article')].forEach((wrapper) => {
        if (!(wrapper instanceof HTMLElement)) return;
        if (wrapper.tagName === 'TABLE') return;
        if (!isTableWrapperElement(wrapper)) return;
        if (wrapper.querySelector('table.pdf-export-table')) {
          const t = wrapper.querySelector('table.pdf-export-table');
          if (t) wrapper.replaceWith(t);
          return;
        }
        try {
          const view = doc.defaultView || window;
          const matrix = tryExtractTableMatrix(wrapper, view);
          if (matrix && matrix.length >= 2) {
            wrapper.replaceWith(buildTableFromMatrix(matrix));
          }
        } catch (err) {
          console.warn('[Qwen PDF] Table wrapper conversion failed:', err);
        }
      });
    });
  }

  function cloneContentForPdf(node, imageMap = null) {
    const source = /** @type {HTMLElement} */ (node);
    let tableRegions = [];

    if (messageHasTableLikeContent(source)) {
      try {
        tableRegions = collectTableRegions(source);
      } catch (err) {
        console.warn('[Qwen PDF] Table region collection failed:', err);
      }
    }

    const clone = /** @type {HTMLElement} */ (node.cloneNode(true));

    tableRegions.forEach((r) => {
      try {
        r.el.removeAttribute('data-qwen-pdf-table-id');
      } catch {
      }
    });

    if (imageMap?.size) {
      applyMathCapturesToClone(clone, imageMap);
    }

    clone.querySelectorAll(STRIP_FROM_CLONE_SELECTORS).forEach((n) => n.remove());
    clone.querySelectorAll('[style*="display: none"], [hidden]').forEach((n) => n.remove());

    clone.querySelectorAll('svg').forEach((svg) => {
      if (!svg.closest('.katex, [class*="katex"], mjx-container, [class*="MathJax"]')) {
        svg.remove();
      }
    });

    clone.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('#')) {
        a.setAttribute('title', href);
      }
    });

    clone.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src && src.startsWith('/')) {
        img.src = new URL(src, location.origin).href;
      }
    });

    clone.querySelectorAll('tr').forEach((tr) => {
      if (!(tr.textContent || '').replace(/\s/g, '')) tr.remove();
    });
    clone.querySelectorAll('table').forEach((table) => {
      if (!table.querySelector('tr')) table.remove();
    });
    clone.querySelectorAll('div, p, span').forEach((el) => {
      if (
        el instanceof HTMLElement &&
        !el.querySelector('img, table, pre, .katex') &&
        !(el.textContent || '').trim() &&
        el.children.length === 0
      ) {
        el.remove();
      }
    });

    clone.querySelectorAll('[style]').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (shouldPreserveLayoutStyles(el)) return;
      el.removeAttribute('style');
    });

    clone.style.setProperty('color', '#1a1a2e', 'important');
    clone.querySelectorAll('*').forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (child.closest('.katex, [class*="katex"], math, mjx-container')) return;
      if (shouldPreserveLayoutStyles(child)) return;
      child.style.setProperty('color', '#1a1a2e', 'important');
    });

    enhanceCloneTables(source, clone, tableRegions);
    insertBreaksBeforeSteps(clone);
    return clone;
  }

  function insertBreaksBeforeSteps(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const v = node.nodeValue;
      if (!v || !/Step\s*\d/i.test(v)) continue;
      const next = v
        .replace(/([A-Za-z0-9)\]])\s*(Step\s*\d+)/gi, '$1\n$2')
        .replace(/([a-z]\))\s*([A-Z])/g, '$1\n$2');
      if (next !== v) node.nodeValue = next;
    }

    root.querySelectorAll('p, li, h2, h3, h4, strong').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const html = el.innerHTML;
      if (/Step\s*\d/i.test(html) && !/<br\s*\/?>/i.test(html)) {
        el.innerHTML = html.replace(/([A-Za-z0-9)\]])\s*(Step\s*\d+)/gi, '$1<br>$2');
      }
    });
  }

  function convertAriaTables(root) {
    root.querySelectorAll('[role="table"]').forEach((tableDiv) => {
      if (!(tableDiv instanceof HTMLElement) || tableDiv.tagName === 'TABLE') return;

      const rows = [...tableDiv.querySelectorAll('[role="row"]')];
      if (rows.length < 2) return;

      const table = document.createElement('table');
      table.className = 'pdf-export-table';

      rows.forEach((row, rowIdx) => {
        const cells = [
          ...row.querySelectorAll('[role="cell"], [role="columnheader"], [role="rowheader"]'),
        ];
        if (!cells.length) return;

        const tr = document.createElement('tr');
        cells.forEach((cell, cellIdx) => {
          const tag =
            rowIdx === 0 ||
            cell.getAttribute('role') === 'columnheader' ||
            cellIdx === 0
              ? 'th'
              : 'td';
          const td = document.createElement(tag);
          td.innerHTML = cell.innerHTML;
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });

      if (table.querySelector('tr')) tableDiv.replaceWith(table);
    });
  }

  function shouldPreserveLayoutStyles(el) {
    if (el.closest('.katex, [class*="katex"], math, mjx-container')) return true;
    const tag = el.tagName;
    if (tag === 'TABLE' || tag === 'TR' || tag === 'TD' || tag === 'TH' || tag === 'THEAD' || tag === 'TBODY') {
      return true;
    }
    const cls = (el.className || '').toString().toLowerCase();
    if (/table|grid|row|cell|column|tabular/.test(cls)) return true;
    if (el.classList.contains('pdf-export-table')) return true;
    return false;
  }

  function walkPair(orig, clone, fn) {
    if (!(orig instanceof Element) || !(clone instanceof Element)) return;
    fn(orig, clone);
    const oKids = [...orig.children];
    const cKids = [...clone.children];
    const len = Math.min(oKids.length, cKids.length);
    for (let i = 0; i < len; i++) walkPair(oKids[i], cKids[i], fn);
  }

  function parseGridColumnCount(template, el) {
    if (template && template !== 'none') {
      const repeat = template.match(/repeat\s*\(\s*(\d+)/i);
      if (repeat) return parseInt(repeat[1], 10);

      const parts = template.split(/\s+/).filter((p) => p && p !== 'none' && !/^repeat/i.test(p));
      if (parts.length >= 2) return parts.length;
    }

    const n = el?.children?.length || 0;
    if (n >= 4) {
      for (const cols of [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
        if (n % cols === 0 && n / cols <= 6) return cols;
      }
    }

    return n >= 2 ? 2 : 0;
  }

  function gridElementToTable(el, colCount) {
    const cells = [...el.children].filter((c) => c instanceof HTMLElement);
    if (cells.length < colCount) return null;

    const table = document.createElement('table');
    table.className = 'pdf-export-table';

    for (let i = 0; i < cells.length; i += colCount) {
      const tr = document.createElement('tr');
      for (let j = 0; j < colCount && i + j < cells.length; j++) {
        const cellTag = i === 0 ? 'th' : 'td';
        const cell = document.createElement(cellTag);
        cell.innerHTML = cells[i + j].innerHTML;
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    }
    return table;
  }

  function gridsToTable(gridEls) {
    const table = document.createElement('table');
    table.className = 'pdf-export-table';

    gridEls.forEach((grid, rowIdx) => {
      const tr = document.createElement('tr');
      [...grid.children]
        .filter((c) => c instanceof HTMLElement)
        .forEach((c) => {
          const cell = document.createElement(rowIdx === 0 ? 'th' : 'td');
          cell.innerHTML = c.innerHTML;
          tr.appendChild(cell);
        });
      if (tr.children.length) table.appendChild(tr);
    });

    enhanceHtmlTable(table);
    return table;
  }

  function enhanceHtmlTable(table) {
    const colCount = table.rows[0]?.cells.length || 0;
    table.classList.add('pdf-export-table');
    table.style.borderCollapse = 'collapse';
    if (colCount > 6) {
      table.classList.add('pdf-export-table-wide');
      table.style.width = '100%';
      table.style.tableLayout = 'fixed';
      table.style.fontSize = colCount > 8 ? '8.5pt' : '9pt';
    } else {
      table.style.width = '100%';
      table.style.tableLayout = 'auto';
    }
  }

  function mergeAdjacentSingleRowTables(root) {
    const parents = new Set();
    root.querySelectorAll('table.pdf-export-table, table').forEach((t) => {
      if (t.parentElement) parents.add(t.parentElement);
    });

    parents.forEach((parent) => {
      const kids = [...parent.children];
      let buffer = [];

      const flush = () => {
        if (buffer.length < 2) {
          buffer = [];
          return;
        }
        const cols = buffer[0].rows[0]?.cells.length || 0;
        if (!cols || buffer.some((t) => (t.rows[0]?.cells.length || 0) !== cols)) {
          buffer = [];
          return;
        }

        const anchor = buffer[0];
        const merged = document.createElement('table');
        merged.className = anchor.className || 'pdf-export-table';
        buffer.forEach((t) => {
          [...t.rows].forEach((row) => merged.appendChild(row.cloneNode(true)));
          t.remove();
        });
        parent.insertBefore(merged, anchor);
        enhanceHtmlTable(merged);
        buffer = [];
      };

      for (const child of kids) {
        if (
          child.tagName === 'TABLE' &&
          child.rows.length >= 1 &&
          child.rows.length <= 2
        ) {
          buffer.push(/** @type {HTMLTableElement} */ (child));
        } else {
          flush();
        }
      }
      flush();
    });
  }

  function mergeConsecutiveGrids(root) {
    const parents = new Set();
    root.querySelectorAll('*').forEach((el) => {
      if (el.parentElement) parents.add(el.parentElement);
    });

    parents.forEach((parent) => {
      const kids = [...parent.children];
      let group = [];

      const flush = () => {
        if (group.length < 2) {
          group = [];
          return;
        }

        const anchor = group[0].el;
        const merged = document.createElement('table');
        merged.className = 'pdf-export-table';

        group.forEach(({ el }, rowIdx) => {
          const tr = document.createElement('tr');
          [...el.children]
            .filter((c) => c instanceof HTMLElement)
            .forEach((c) => {
              const cell = document.createElement(rowIdx === 0 ? 'th' : 'td');
              cell.innerHTML = c.innerHTML;
              tr.appendChild(cell);
            });
          if (tr.children.length) merged.appendChild(tr);
        });

        parent.insertBefore(merged, anchor);
        group.forEach(({ el }) => el.remove());
        enhanceHtmlTable(merged);
        group = [];
      };

      for (const child of kids) {
        if (!(child instanceof HTMLElement)) continue;
        const cs = window.getComputedStyle(child);
        if (cs.display === 'grid') {
          const cols = parseGridColumnCount(cs.gridTemplateColumns, child);
          if (cols >= 2 && child.children.length >= cols) {
            if (group.length && group[group.length - 1].cols === cols) {
              group.push({ el: child, cols });
            } else {
              flush();
              group = [{ el: child, cols }];
            }
            continue;
          }
        }
        flush();
        group = [];
      }
      flush();
    });
  }

  function enhanceTablesFromOriginal(original, clone) {
    const skippedOrig = new WeakSet();

    walkPair(original, clone, (origEl, cloneEl) => {
      if (!(origEl instanceof HTMLElement) || !(cloneEl instanceof HTMLElement)) return;
      if (skippedOrig.has(origEl)) return;

      if (origEl.tagName === 'TABLE') {
        enhanceHtmlTable(/** @type {HTMLTableElement} */ (cloneEl));
        return;
      }

      const cs = window.getComputedStyle(origEl);
      if (cs.display === 'grid') {
        const cols = parseGridColumnCount(cs.gridTemplateColumns, origEl);
        if (cols < 2 || origEl.children.length < cols) return;

        const gridGroup = [origEl];
        let sib = origEl.nextElementSibling;
        while (sib instanceof HTMLElement) {
          const scs = window.getComputedStyle(sib);
          if (scs.display !== 'grid') break;
          const scols = parseGridColumnCount(scs.gridTemplateColumns, sib);
          if (scols !== cols || sib.children.length < cols) break;
          gridGroup.push(sib);
          sib = sib.nextElementSibling;
        }

        if (gridGroup.length > 1) {
          const cloneGrids = [cloneEl];
          let cloneSib = cloneEl.nextElementSibling;
          for (let i = 1; i < gridGroup.length; i++) {
            gridGroup[i] && skippedOrig.add(gridGroup[i]);
            if (cloneSib instanceof HTMLElement) {
              cloneGrids.push(cloneSib);
              cloneSib = cloneSib.nextElementSibling;
            }
          }
          if (cloneGrids.length >= 2) {
            const table = gridsToTable(cloneGrids);
            cloneEl.replaceWith(table);
            cloneGrids.slice(1).forEach((g) => g.remove());
          }
          return;
        }

        if (origEl.children.length % cols === 0) {
          const table = gridElementToTable(cloneEl, cols);
          if (table) cloneEl.replaceWith(table);
        }
        return;
      }

      if (cs.display === 'table' || origEl.getAttribute('role') === 'table') {
        cloneEl.style.display = 'table';
        cloneEl.style.width = '100%';
        cloneEl.style.borderCollapse = 'collapse';
      }
    });
  }

  function repairStackedTables(root) {
    root.querySelectorAll('table').forEach((table) => {
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length < 4) return;

      const singleCol = rows.every((tr) => tr.querySelectorAll('td, th').length === 1);
      if (!singleCol) return;

      const cellHtml = rows.map((tr) => {
        const c = tr.querySelector('td, th');
        return c ? c.innerHTML : '';
      });
      const plain = cellHtml.map((h) => h.replace(/<[^>]+>/g, '').trim());

      const breaks = [0];
      for (let i = 1; i < plain.length; i++) {
        const prevLen = i - breaks[breaks.length - 1];
        if (
          prevLen >= 2 &&
          /^[A-Za-z][A-Za-z0-9()]*$/.test(plain[i]) &&
          plain[i].length <= 10
        ) {
          breaks.push(i);
        }
      }
      if (breaks.length < 2) return;

      const newTable = document.createElement('table');
      newTable.className = 'pdf-export-table';
      breaks.forEach((start, idx) => {
        const end = breaks[idx + 1] ?? cellHtml.length;
        const tr = document.createElement('tr');
        for (let i = start; i < end; i++) {
          const cell = document.createElement(i === start ? 'th' : 'td');
          cell.innerHTML = cellHtml[i];
          tr.appendChild(cell);
        }
        newTable.appendChild(tr);
      });
      table.replaceWith(newTable);
    });
  }

  function convertStackedParagraphsToTable(root) {
    const parents = root.querySelectorAll(
      '.message-body, .markdown-prose, [class*="markdown"], .prose'
    );

    parents.forEach((container) => {
      const children = [...container.children];
      let run = [];

      const flush = () => {
        if (run.length < 6) {
          run = [];
          return;
        }
        const plain = run.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
        if (!plain.length || !plain.every((t) => t.length > 0 && t.length <= 14)) {
          run = [];
          return;
        }
        if (!/^(x|p\s*\(|p\s*\(x\)|f\s*\(x\))/i.test(plain[0]) && !/^[A-Za-z]$/.test(plain[0])) {
          run = [];
          return;
        }

        const breaks = [0];
        for (let i = 1; i < plain.length; i++) {
          const span = i - breaks[breaks.length - 1];
          if (span >= 2 && /^[A-Za-z][A-Za-z0-9()]*$/.test(plain[i]) && plain[i].length <= 10) {
            breaks.push(i);
          }
        }
        if (breaks.length < 2) {
          run = [];
          return;
        }

        const table = document.createElement('table');
        table.className = 'pdf-export-table';
        breaks.forEach((start, idx) => {
          const end = breaks[idx + 1] ?? run.length;
          const tr = document.createElement('tr');
          for (let i = start; i < end; i++) {
            const cell = document.createElement(i === start ? 'th' : 'td');
            cell.innerHTML = run[i].innerHTML;
            tr.appendChild(cell);
          }
          table.appendChild(tr);
        });

        if (run[0]) run[0].before(table);
        run.forEach((el) => el.remove());
        run = [];
      };

      for (const child of children) {
        if (
          (child.tagName === 'P' || child.tagName === 'DIV') &&
          !child.querySelector('table, .katex-display, pre, ul, ol, h1, h2, h3')
        ) {
          const t = (child.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length <= 14) {
            run.push(child);
            continue;
          }
        }
        flush();
      }
      flush();
    });
  }

  function extractLatexRaw(mathEl) {
    const candidates = [mathEl];
    const inner = mathEl.querySelector?.('.katex');
    if (inner) candidates.push(inner);

    for (const el of candidates) {
      const ann = el.querySelector?.(
        'annotation[encoding="application/x-tex"], annotation[encoding="text/x-tex"], annotation[encoding="text/plain"]'
      );
      if (ann?.textContent?.trim()) {
        return ann.textContent.trim().replace(/^\$+|\$+$/g, '');
      }

      const dataLatex =
        el.getAttribute?.('data-latex') ||
        el.querySelector?.('[data-latex]')?.getAttribute('data-latex');
      if (dataLatex?.trim()) {
        return dataLatex.trim().replace(/^\$+|\$+$/g, '');
      }
    }

    for (const el of candidates) {
      const aria = el.getAttribute?.('aria-label');
      if (aria && aria.length > 0 && aria.length < 500) {
        const trimmed = aria.trim().replace(/^\$+|\$+$/g, '');
        if (trimmed) return trimmed;
      }
    }

    const katexHtml =
      mathEl.querySelector?.('.katex-html') ||
      (mathEl.classList?.contains('katex-html') ? mathEl : null);
    if (katexHtml) {
      const rendered = (katexHtml.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (rendered && rendered.length <= 200) return rendered;
    }

    return null;
  }

  function normalizeMathLayout(root) {
    root.querySelectorAll('.katex-mathml, math, semantics').forEach((n) => n.remove());
    root.querySelectorAll('annotation').forEach((n) => n.remove());

    root.querySelectorAll('*').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest('table, .pdf-export-table')) return;
      if (!el.querySelector('.katex, .katex-display')) return;

      const cls = (el.className || '').toString().toLowerCase();
      if (/table|grid|row|cell|column|tabular/.test(cls)) return;

      const display = el.style.display || '';
      if (display === 'flex' || display === 'inline-flex') {
        el.style.display = 'block';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'stretch';
        el.style.gap = '0';
      }

      if (!el.closest('.katex')) {
        if (el.style.position === 'absolute' || el.style.position === 'fixed') {
          el.style.position = 'static';
        }
        if (el.style.float === 'right' || el.style.float === 'left') {
          el.style.float = 'none';
          el.style.clear = 'both';
        }
      }
    });
  }

  function convertKatexToPending(root) {
    const targets = [];

    root.querySelectorAll('.katex-display').forEach((el) => targets.push(el));
    root.querySelectorAll('.katex').forEach((el) => {
      if (!el.closest('.katex-display')) targets.push(el);
    });

    for (const mathEl of targets) {
      if (!mathEl.parentElement || mathEl.closest('.pdf-math-pending')) continue;

      const isDisplay = mathEl.classList.contains('katex-display');
      const latex = extractLatexRaw(mathEl);
      if (!latex) continue;

      const span = document.createElement('span');
      span.className = 'pdf-math-pending' + (isDisplay ? ' pdf-math-display' : '');
      span.setAttribute('data-latex', latex);
      span.setAttribute('data-display', isDisplay ? '1' : '0');
      mathEl.replaceWith(span);
    }
  }

  async function renderMathInExportIframe(iframe) {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) return;

    const pending = doc.querySelectorAll('.pdf-math-pending');
    if (!pending.length) return;

    const katexUrl = chrome.runtime.getURL('libs/katex.min.js');
    await new Promise((resolve, reject) => {
      if (win.katex) {
        resolve();
        return;
      }
      const s = doc.createElement('script');
      s.src = katexUrl;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load KaTeX.'));
      doc.head.appendChild(s);
    });

    pending.forEach((el) => {
      const latex = el.getAttribute('data-latex');
      if (!latex || !win.katex) return;
      const displayMode = el.getAttribute('data-display') === '1';
      try {
        win.katex.render(latex, el, {
          displayMode,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
        });
        el.classList.remove('pdf-math-pending');
      } catch {
        el.textContent = latex;
      }
    });
  }

  async function loadHtml2CanvasInIframe(iframe) {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error('Export iframe unavailable.');
    if (win.html2canvas) return win.html2canvas;

    const url = chrome.runtime.getURL('libs/html2canvas.min.js');
    await new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load html2canvas.'));
      doc.head.appendChild(s);
    });

    if (!win.html2canvas) throw new Error('html2canvas failed to initialize.');
    return win.html2canvas;
  }

  function isTableOnlyBlock(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.matches('table, .pdf-export-table')) return true;
    return !!(el.querySelector('table, .pdf-export-table') && !el.querySelector('.katex'));
  }

  function getMathSectionRoot(body) {
    if (body.children.length === 1) {
      const only = body.firstElementChild;
      if (
        only instanceof HTMLElement &&
        only.tagName === 'DIV' &&
        !only.matches('table, .pdf-export-table')
      ) {
        return only;
      }
    }
    return body;
  }

  function collectConsecutiveMathSections(root) {
    const sections = [];
    const kids = [...root.children].filter((c) => c instanceof HTMLElement);

    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (isTableOnlyBlock(child)) continue;
      if (!child.querySelector('.katex, .katex-display')) continue;

      const group = [child];
      let j = i + 1;
      while (j < kids.length) {
        const next = kids[j];
        if (isTableOnlyBlock(next)) break;
        if (!next.querySelector('.katex, .katex-display')) break;
        group.push(next);
        j++;
      }
      sections.push(group);
      i = j - 1;
    }

    return sections;
  }

  function restoreLiveMathMarks(marks) {
    for (const { wrapper } of marks) {
      if (!wrapper?.parentElement) continue;
      const parent = wrapper.parentElement;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  }

  async function prepareLiveMathCaptures(contentNode) {
    if (!contentNode.querySelector('.katex, .katex-display')) {
      return { imageMap: new Map(), marks: [] };
    }

    const root = getMathSectionRoot(contentNode);
    const sections = collectConsecutiveMathSections(root);
    const marks = [];

    for (const nodes of sections) {
      const id = `mc${marks.length}`;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-qwen-math-cap', id);
      Object.assign(wrapper.style, {
        background: '#ffffff',
        margin: '0',
        padding: '0',
        display: 'block',
      });
      nodes[0].before(wrapper);
      nodes.forEach((n) => wrapper.appendChild(n));
      marks.push({ id, wrapper });
    }

    if (!marks.length) return { imageMap: new Map(), marks: [] };

    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_MATH_REGIONS',
      items: marks.map((m) => ({ id: m.id })),
    });

    if (!response?.success) {
      restoreLiveMathMarks(marks);
      throw new Error(response?.error || 'Could not capture math from the page.');
    }

    const imageMap = new Map();
    for (const cap of response.captures || []) {
      if (cap?.id && cap?.dataUrl) imageMap.set(cap.id, cap);
    }

    return { imageMap, marks };
  }

  function createLiveMathMarksForMessage(contentNode, idPrefix) {
    if (!contentNode.querySelector('.katex, .katex-display')) return [];

    const root = getMathSectionRoot(contentNode);
    const toWrap = [...root.children].filter(
      (child) =>
        child instanceof HTMLElement &&
        !isTableOnlyBlock(child) &&
        child.querySelector('.katex, .katex-display')
    );

    if (!toWrap.length) return [];

    const id = `${idPrefix}-math`;
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-qwen-math-cap', id);
    Object.assign(wrapper.style, {
      background: '#ffffff',
      margin: '0',
      padding: '0',
      display: 'block',
    });

    toWrap[0].before(wrapper);
    toWrap.forEach((n) => wrapper.appendChild(n));

    return [{ id, wrapper }];
  }

  async function batchCaptureLiveMath(marks, attr = 'data-qwen-math-cap') {
    if (!marks.length) return new Map();

    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_MATH_REGIONS',
      attr,
      items: marks.map((m) => ({ id: m.id })),
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Could not capture math from the page.');
    }

    const imageMap = new Map();
    for (const cap of response.captures || []) {
      if (cap?.id && cap?.dataUrl) imageMap.set(cap.id, cap);
    }
    return imageMap;
  }

  function buildLiveMessageHtml(cap) {
    const safeSrc = cap.dataUrl.replace(/"/g, '&quot;');
    return `<img class="pdf-message-math-raster pdf-live-message-body" src="${safeSrc}" alt="Message content" />`;
  }

  async function captureLiveMessageBodies(items) {
    return batchCaptureLiveMath(items, 'data-qwen-pdf-live-cap');
  }

  function applyMathCapturesToClone(clone, imageMap) {
    if (!imageMap?.size) return;

    clone.querySelectorAll('[data-qwen-math-cap]').forEach((wrapper) => {
      if (!(wrapper instanceof HTMLElement)) return;
      const id = wrapper.getAttribute('data-qwen-math-cap');
      const cap = id ? imageMap.get(id) : null;

      if (!cap?.dataUrl) {
        wrapper.remove();
        return;
      }

      const img = document.createElement('img');
      img.src = cap.dataUrl;
      img.className = 'pdf-live-math';
      img.alt = 'math';
      img.style.cssText =
        'display:block;width:100%;max-width:100%;height:auto;margin:0.45em 0;border:0;';
      wrapper.replaceWith(img);
    });

    clone.querySelectorAll('.katex, .katex-display, .katex-mathml, math, semantics').forEach((k) => {
      if (!k.closest('table, .pdf-export-table, td, th')) k.remove();
    });
  }

  function stripRemainingKatex(root) {
    [...root.querySelectorAll('.katex, .katex-display')].forEach((katex) => {
      if (!(katex instanceof HTMLElement) || !katex.isConnected) return;
      if (
        katex.closest(
          'table, .pdf-export-table, .pdf-math-raster, .pdf-message-math-raster, .pdf-table-raster'
        )
      ) {
        return;
      }
      const text = (katex.textContent || '').replace(/\s+/g, ' ').trim();
      katex.replaceWith(root.ownerDocument.createTextNode(text ? ` ${text} ` : ' '));
    });
  }

  async function rasterizeMessageBodyAsImage(body, doc, html2canvas) {
    const win = doc.defaultView;
    if (!win) return false;

    prepareElementForMathCapture(body);
    body.style.setProperty('background', '#ffffff', 'important');
    body.style.setProperty('width', `${EXPORT_CONTENT_MAX_PX}px`, 'important');
    body.style.setProperty('overflow', 'visible', 'important');
    body.style.setProperty('padding', '8px 4px', 'important');

    let parent = body.parentElement;
    while (parent && !parent.classList?.contains('message-card')) {
      if (parent instanceof HTMLElement) {
        parent.style.overflow = 'visible';
        parent.style.overflowX = 'visible';
        parent.style.maxWidth = 'none';
      }
      parent = parent.parentElement;
    }

    await new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
    await sleep(120);

    const rect = body.getBoundingClientRect();
    const captureW = Math.ceil(Math.max(rect.width, body.scrollWidth, 400));
    const captureH = measureMathCaptureHeight(body);

    let canvas;
    try {
      canvas = await html2canvas(body, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: true,
        scrollX: 0,
        scrollY: 0,
        width: captureW,
        height: captureH,
        windowWidth: captureW + 64,
        windowHeight: captureH + 80,
        onclone: (_clonedDoc, clonedEl) => {
          if (clonedEl instanceof HTMLElement) prepareElementForMathCapture(clonedEl);
        },
      });
    } catch (err) {
      console.warn('[Qwen PDF] Full message capture failed:', err);
      return false;
    }

    if (!canvas || canvas.width < 16 || canvas.height < 16) return false;

    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl || dataUrl.length < 200) return false;

    const img = doc.createElement('img');
    img.src = dataUrl;
    img.className = 'pdf-message-math-raster';
    img.alt = 'Message content';

    const w = Math.ceil(canvas.width / 2);
    const h = Math.ceil(canvas.height / 2);
    img.style.display = 'block';
    img.style.width = w > EXPORT_CONTENT_MAX_PX ? '100%' : `${w}px`;
    img.style.height = 'auto';
    img.style.maxWidth = '100%';
    img.style.margin = '0';
    img.style.border = '0';
    img.style.background = '#ffffff';

    body.replaceChildren(img);
    return true;
  }

  function removeHiddenMathLayers(body) {
    body.querySelectorAll('.katex-mathml, math, semantics, annotation').forEach((n) => {
      if (!n.closest('table, .pdf-export-table')) n.remove();
    });

    body.querySelectorAll('.katex').forEach((katex) => {
      const layers = katex.querySelectorAll(':scope > .katex-html');
      for (let i = 1; i < layers.length; i++) layers[i].remove();
    });
  }

  function measureMathCaptureHeight(el) {
    const base = el.getBoundingClientRect();
    let bottom = base.bottom;
    el.querySelectorAll('.katex, .katex-display').forEach((k) => {
      bottom = Math.max(bottom, k.getBoundingClientRect().bottom);
    });
    return Math.ceil(bottom - base.top + 28);
  }

  async function captureMathSection(nodes, doc, html2canvas) {
    if (!nodes.length) return;

    if (nodes.length === 1) {
      await rasterizeToImage(nodes[0], doc, html2canvas);
      return;
    }

    const wrapper = doc.createElement('div');
    wrapper.className = 'pdf-math-section-capture';
    Object.assign(wrapper.style, {
      display: 'block',
      background: '#ffffff',
      padding: '14px 12px',
      margin: '0.6em 0',
      overflow: 'visible',
      width: '100%',
      boxSizing: 'border-box',
    });

    nodes[0].before(wrapper);
    nodes.forEach((n) => wrapper.appendChild(n));
    await rasterizeToImage(wrapper, doc, html2canvas);
  }

  function promoteMathBlockGroups(targets) {
    const promoted = new Set();
    const result = [];

    for (const el of targets) {
      if (promoted.has(el)) continue;

      let groupParent = null;
      let node = el.parentElement;
      while (node && !node.classList.contains('message-body')) {
        if (node instanceof HTMLElement && node.tagName === 'DIV') {
          const directPs = [...node.children].filter(
            (c) => c instanceof HTMLElement && c.tagName === 'P'
          );
          const mathPs = directPs.filter((p) => targets.includes(p));
          if (mathPs.length >= 2 && mathPs.length >= directPs.length * 0.5) {
            groupParent = node;
            break;
          }
        }
        node = node.parentElement;
      }

      if (groupParent && !promoted.has(groupParent)) {
        directPsInGroup(groupParent, targets).forEach((p) => promoted.add(p));
        promoted.add(groupParent);
        result.push(groupParent);
        continue;
      }

      result.push(el);
    }

    return result.filter(
      (el, _i, arr) => !arr.some((other) => other !== el && other.contains(el))
    );

    function directPsInGroup(parent, list) {
      return [...parent.children].filter(
        (c) => c instanceof HTMLElement && c.tagName === 'P' && list.includes(c)
      );
    }
  }

  function collectMathCaptureBlocks(root) {
    const candidates = new Set();

    const addBlock = (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest('table, .pdf-export-table, .pdf-math-raster')) return;
      if (!el.querySelector('.katex, .katex-display')) return;
      candidates.add(el);
    };

    root.querySelectorAll('.katex-display').forEach((kd) => {
      if (kd.closest('table, .pdf-export-table')) return;
      const parent = kd.parentElement;
      if (parent instanceof HTMLElement && parent.matches('p, li, div, blockquote')) {
        addBlock(parent);
      } else {
        addBlock(/** @type {HTMLElement} */ (kd));
      }
    });

    root.querySelectorAll('.katex').forEach((k) => {
      if (k.closest('.katex-display, table, .pdf-export-table, .pdf-math-raster')) return;
      let block = null;
      let node = k.parentElement;
      while (node && !node.classList.contains('message-body')) {
        if (
          node instanceof HTMLElement &&
          node.matches('p, li, td, th, blockquote, h1, h2, h3, h4, div, pre')
        ) {
          block = node;
        }
        node = node.parentElement;
      }
      addBlock(block || /** @type {HTMLElement} */ (k));
    });

    let list = [...candidates].filter(
      (el, _i, arr) => !arr.some((other) => other !== el && el.contains(other))
    );

    list = promoteMathBlockGroups(list);

    return list.sort((a, b) => {
      const pos = b.compareDocumentPosition(a);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
      return 0;
    });
  }

  function collectMathRasterTargets(doc) {
    const candidates = [];

    doc.querySelectorAll('.message-body .katex, .message-body .katex-display').forEach((katex) => {
      let node = katex.parentElement;
      let block = null;
      while (node && !node.classList.contains('message-body')) {
        if (
          node instanceof HTMLElement &&
          node.matches('p, li, div, blockquote, h1, h2, h3, h4, pre, ul, ol')
        ) {
          block = node;
        }
        node = node.parentElement;
      }
      if (block) candidates.push(block);
    });

    let targets = candidates.filter(
      (el, i, arr) => !arr.some((other) => other !== el && other.contains(el))
    );

    targets = targets.filter((el) => !el.closest('table, .pdf-export-table, .pdf-table-raster'));

    targets = promoteMathBlockGroups(targets);

    return targets.sort((a, b) => {
      const pos = b.compareDocumentPosition(a);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
      return 0;
    });
  }

  function forceExportReadableColors(el) {
    if (!(el instanceof HTMLElement)) return;
    const textTags = new Set([
      'P',
      'SPAN',
      'DIV',
      'LI',
      'TD',
      'TH',
      'H1',
      'H2',
      'H3',
      'H4',
      'STRONG',
      'EM',
      'B',
      'I',
      'PRE',
      'CODE',
    ]);
    const walk = (node) => {
      if (!(node instanceof HTMLElement)) return;
      if (textTags.has(node.tagName) || node.classList.contains('katex') || node.closest('.katex')) {
        node.style.setProperty('color', '#111827', 'important');
        node.style.setProperty('-webkit-text-fill-color', '#111827', 'important');
        node.style.setProperty('opacity', '1', 'important');
      }
      if (node.tagName === 'SVG') {
        node.querySelectorAll('[fill]').forEach((part) => {
          const fill = part.getAttribute('fill');
          if (fill && fill !== 'none' && fill !== 'transparent') {
            part.setAttribute('fill', '#111827');
          }
        });
      }
      for (const child of node.children) walk(child);
    };
    el.style.setProperty('background', '#ffffff', 'important');
    el.style.setProperty('color', '#111827', 'important');
    walk(el);
  }

  function prepareElementForMathCapture(el) {
    el.style.overflow = 'visible';
    el.style.lineHeight = '1.85';
    el.style.background = '#ffffff';
    el.style.padding = '10px 8px';
    el.style.margin = '0.35em 0';
    forceExportReadableColors(el);

    el.querySelectorAll('.katex, .katex-display').forEach((katex) => {
      if (!(katex instanceof HTMLElement)) return;
      katex.style.overflow = 'visible';
      katex.style.display = 'inline-block';
      katex.style.verticalAlign = 'middle';
    });

    el.querySelectorAll(
      '.katex .base, .katex .strut, .katex .mord, .katex .mop, .katex .mbin, .katex .mrel, .katex .mspace, .katex .msupsub, .katex .vlist-t, .katex .vlist-r, .katex .vlist, .katex .vlist-s'
    ).forEach((n) => {
      if (!(n instanceof HTMLElement)) return;
      n.style.position = 'relative';
      n.style.top = 'auto';
      n.style.left = 'auto';
      n.style.bottom = 'auto';
      n.style.transform = 'none';
    });
  }

  function prepareAllTablesForExport(doc) {
    doc.querySelectorAll('.message-body table, .message-body .pdf-export-table').forEach((table) => {
      if (!(table instanceof HTMLElement)) return;
      table.style.width = 'max-content';
      table.style.tableLayout = 'auto';
      table.style.borderCollapse = 'collapse';
      table.querySelectorAll('td, th').forEach((cell) => {
        if (cell instanceof HTMLElement) cell.style.whiteSpace = 'nowrap';
      });
      let parent = table.parentElement;
      while (parent && !parent.classList?.contains('message-body')) {
        if (parent instanceof HTMLElement) {
          parent.style.overflow = 'visible';
          parent.style.overflowX = 'visible';
          parent.style.maxWidth = 'none';
        }
        parent = parent.parentElement;
      }
    });
  }

  async function rasterizeToImage(el, doc, html2canvas) {
    const isTable = el.tagName === 'TABLE' || el.classList.contains('pdf-export-table');
    const isMath =
      !isTable && !!el.querySelector('.katex, .katex-display, .pdf-math-pending');
    const scale = isMath ? 2 : 2;
    await new Promise((r) => requestAnimationFrame(r));

    if (isTable) {
      el.style.width = 'max-content';
      el.style.tableLayout = 'auto';
    } else if (isMath) {
      prepareElementForMathCapture(el);
    }

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const rect = el.getBoundingClientRect();
    const captureW = Math.ceil(Math.max(el.scrollWidth, rect.width, 8));
    const captureH = isMath
      ? Math.max(measureMathCaptureHeight(el), Math.ceil(el.scrollHeight + 24))
      : Math.ceil(Math.max(el.scrollHeight, rect.height, 8));

    if (captureW < 2 || captureH < 2) return;

    const canvasOpts = {
      scale,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      onclone: (_clonedDoc, clonedEl) => {
        if (!(clonedEl instanceof HTMLElement)) return;
        clonedEl.style.overflow = 'visible';
        if (isMath) prepareElementForMathCapture(clonedEl);
      },
    };

    if (!isMath) {
      canvasOpts.width = captureW;
      canvasOpts.height = captureH;
      canvasOpts.windowWidth = captureW + 48;
      canvasOpts.windowHeight = captureH + 48;
    }

    const canvas = await html2canvas(el, canvasOpts);

    const img = doc.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.className = isTable ? 'pdf-table-raster' : 'pdf-math-raster';
    img.alt = (el.textContent || 'math').replace(/\s+/g, ' ').trim().slice(0, 120);

    const isBlock =
      isTable ||
      el.classList.contains('katex-display') ||
      el.classList.contains('pdf-math-display') ||
      el.tagName === 'UL' ||
      el.tagName === 'OL' ||
      el.tagName === 'LI' ||
      el.tagName === 'P' ||
      el.tagName === 'DIV' ||
      el.tagName === 'BLOCKQUOTE' ||
      /^H[1-4]$/.test(el.tagName);

    const w = Math.ceil(canvas.width / scale);
    const h = Math.ceil(canvas.height / scale);
    const contentMaxW = EXPORT_CONTENT_MAX_PX;

    if (isBlock) {
      img.style.display = 'block';
      img.style.margin = '0.55em 0';
      if ((isTable && w > contentMaxW) || (isMath && w > contentMaxW)) {
        img.style.width = '100%';
        img.style.height = 'auto';
      } else {
        img.style.width = `${w}px`;
        img.style.height = `${h}px`;
        img.style.maxWidth = '100%';
      }
    } else {
      img.style.display = 'inline-block';
      img.style.verticalAlign = 'middle';
      img.style.margin = '0 0.12em';
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
    }

    el.replaceWith(img);
  }

  async function flattenMathSectionsForPdf(iframe) {
    const doc = iframe.contentDocument;
    const bodyEl = doc?.getElementById(EXPORT_BODY_ID);
    if (!doc || !bodyEl?.querySelector('.katex, .katex-display')) return;

    const html2canvas = await loadHtml2CanvasInIframe(iframe);

    for (const body of doc.querySelectorAll('.message-body')) {
      if (!(body instanceof HTMLElement)) continue;
      if (!body.querySelector('.katex, .katex-display')) continue;

      const captured = await rasterizeMessageBodyAsImage(body, doc, html2canvas);
      if (captured) continue;

      const root = getMathSectionRoot(body);
      const targets = collectMathCaptureBlocks(root);

      for (const el of targets) {
        if (!el.isConnected || el.querySelector('.pdf-math-raster')) continue;
        try {
          await rasterizeToImage(el, doc, html2canvas);
        } catch (err) {
          console.warn('[Qwen PDF] Math block capture failed:', err);
        }
      }

      removeHiddenMathLayers(body);
    }

    stripRemainingKatex(bodyEl);
  }

  async function rasterizeTablesForPdf(iframe) {
    const doc = iframe.contentDocument;
    if (!doc) return;

    const tables = doc.querySelectorAll('.message-body table, .message-body .pdf-export-table');
    if (!tables.length) return;

    const html2canvas = await loadHtml2CanvasInIframe(iframe);
    const targets = [...tables].sort((a, b) => {
      const pos = b.compareDocumentPosition(a);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
      return 0;
    });

    for (const table of targets) {
      if (!table.isConnected) continue;
      try {
        await rasterizeToImage(table, doc, html2canvas);
      } catch (err) {
        console.warn('[Qwen PDF] Table rasterize skipped:', err);
      }
    }
  }

  function plainTextToHtml(text) {
    return text
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function extractLatexFromMathNode(mathEl) {
    const ann = mathEl.querySelector?.(
      'annotation[encoding="application/x-tex"], annotation[encoding="text/x-tex"], annotation[encoding="text/plain"]'
    );
    if (ann?.textContent?.trim()) {
      const tex = ann.textContent.trim();
      return tex.startsWith('$') ? tex : `$${tex}$`;
    }

    const dataLatex =
      mathEl.getAttribute?.('data-latex') ||
      mathEl.querySelector?.('[data-latex]')?.getAttribute('data-latex');
    if (dataLatex?.trim()) {
      const tex = dataLatex.trim();
      return tex.startsWith('$') ? tex : `$${tex}$`;
    }

    const aria = mathEl.getAttribute?.('aria-label');
    if (aria && aria.length < 400 && /[=+\-^_{}\\]/.test(aria)) {
      return `$${aria}$`;
    }

    return null;
  }

  function getMessagePlainText(node) {
    const clone = /** @type {HTMLElement} */ (node.cloneNode(true));

    clone
      .querySelectorAll(
        '.katex, .katex-display, [class*="katex"], math, mjx-container, [class*="MathJax"]'
      )
      .forEach((mathEl) => {
        const latex = extractLatexFromMathNode(mathEl);
        mathEl.replaceWith(document.createTextNode(latex ? ` ${latex} ` : ' '));
      });

    clone.querySelectorAll(STRIP_FROM_CLONE_SELECTORS).forEach((n) => n.remove());

    let text = (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\r\n/g, '\n');

    text = normalizeMathSymbolsForPdf(text);
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeMathSymbolsForPdf(text) {
    return text
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<=')
      .replace(/≠/g, '!=')
      .replace(/±/g, '+/-')
      .replace(/×/g, 'x')
      .replace(/÷/g, '/')
      .replace(/∞/g, 'infinity')
      .replace(/π/g, 'pi')
      .replace(/Σ/g, 'SUM')
      .replace(/∑/g, 'SUM')
      .replace(/√/g, 'sqrt')
      .replace(/·/g, '*');
  }

  function serializeMessageContent(node, imageMap = null) {
    const plain = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    const clone = cloneContentForPdf(node, imageMap);
    let html = clone.innerHTML.trim();

    const hasRichContent = !!clone.querySelector(
      '.katex, .katex-display, table, .pdf-export-table, pre, img, .pdf-math-raster'
    );
    if (
      plain &&
      !hasRichContent &&
      (!html || html.length < Math.min(plain.length * 0.3, 40))
    ) {
      html = plainTextToHtml(node.innerText || node.textContent || '');
    }

    return html || (plain ? plainTextToHtml(plain) : '<p><em>(empty message)</em></p>');
  }

  function getExportStyles() {
    const doc = `body.${EXPORT_DOC_CLASS}`;
    return `
    @page { size: A4 landscape; margin: 10mm; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      overflow-x: visible !important;
      position: relative !important;
      left: 0 !important;
    }
    ${doc}, ${doc} * { box-sizing: border-box; }
    ${doc} {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #111827 !important;
      background: #ffffff !important;
      width: ${EXPORT_PAGE_WIDTH_PX}px;
      max-width: ${EXPORT_PAGE_WIDTH_PX}px;
      margin: 0 auto;
      padding: 20px 28px 36px;
      overflow: visible !important;
      position: relative !important;
      left: 0 !important;
      transform: none !important;
    }
    ${doc} .doc-running-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5pt;
      color: #6b7280 !important;
      border-bottom: 1px solid #e5e7eb;
      padding: 10px 0 8px;
      margin-bottom: 20px;
    }
    ${doc} .doc-running-header .doc-title {
      font-weight: 600;
      color: #374151 !important;
    }
    ${doc} .cover {
      text-align: center;
      padding: 56px 16px 48px;
      margin-bottom: 32px;
      page-break-after: always;
    }
    ${doc} .cover h1 {
      font-size: 24pt;
      font-weight: 700;
      margin: 0 0 16px;
      color: #1e293b !important;
      line-height: 1.2;
    }
    ${doc} .cover .meta {
      font-size: 10.5pt;
      color: #64748b !important;
      margin: 4px 0;
    }
    ${doc} .cover .brand {
      margin-top: 32px;
      font-size: 8.5pt;
      color: #94a3b8 !important;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    ${doc} .messages { padding: 0; }
    ${doc} .message-card {
      margin-bottom: 24px;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    ${doc} .message-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e5e7eb;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    ${doc} .message.user .message-header { border-bottom-color: #c7d2fe; }
    ${doc} .message.assistant .message-header { border-bottom-color: #99f6e4; }
    ${doc} .message-role {
      font-size: 10pt;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    ${doc} .message.user .message-role { color: #4338ca !important; }
    ${doc} .message.assistant .message-role { color: #0f766e !important; }
    ${doc} .message-body {
      padding: 4px 2px 8px;
      color: #111827 !important;
    }
    ${doc} .message.user .message-body,
    ${doc} .message.user .message-body p,
    ${doc} .message.user .message-body li,
    ${doc} .message.user .message-body span {
      color: #111827 !important;
      opacity: 1 !important;
    }
    ${doc} .message-body p {
      margin: 0 0 0.9em;
      color: #111827 !important;
      line-height: 1.85;
      overflow: visible;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    ${doc} .message-body blockquote,
    ${doc} .message-body div[class*="answer"],
    ${doc} .message-body div[class*="step"] {
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    ${doc} .message-body h1,
    ${doc} .message-body h2,
    ${doc} .message-body h3 {
      margin: 1.1em 0 0.5em;
      font-weight: 700;
      color: #0f172a !important;
      page-break-after: avoid;
    }
    ${doc} .message-body h2 { font-size: 14pt; }
    ${doc} .message-body h3 { font-size: 12pt; }
    ${doc} .message-body ul,
    ${doc} .message-body ol {
      margin: 0.5em 0 0.85em 1.4em;
      padding: 0;
    }
    ${doc} .message-body li {
      margin-bottom: 0.5em;
      line-height: 1.9;
      overflow: visible;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    ${doc} .message-body li .katex,
    ${doc} .message-body p .katex {
      display: inline-block !important;
      vertical-align: middle !important;
      margin: 0 0.1em !important;
    }
    ${doc} .pdf-export-table-wide {
      font-size: 8.5pt !important;
      width: 100% !important;
      table-layout: fixed !important;
    }
    ${doc} .pdf-export-table-wide th,
    ${doc} .pdf-export-table-wide td {
      padding: 5px 4px !important;
      text-align: center !important;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    ${doc} .message-body pre {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px 14px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 9.5pt;
      page-break-inside: avoid;
      color: #0f172a !important;
    }
    ${doc} .message-body :not(pre) > code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9.5pt;
    }
    ${doc} .message-body table,
    ${doc} .message-body .pdf-export-table {
      width: 100% !important;
      border-collapse: collapse !important;
      display: table !important;
      table-layout: auto !important;
      margin: 1em 0;
      font-size: 10pt;
      page-break-inside: avoid;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: #ffffff !important;
    }
    ${doc} .message-body div[class*="table"],
    ${doc} .message-body div[class*="Table"] {
      display: block !important;
      background: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    ${doc} .message-body table thead,
    ${doc} .message-body table tbody,
    ${doc} .message-body table tr {
      display: table-row !important;
    }
    ${doc} .message-body table th,
    ${doc} .message-body table td {
      display: table-cell !important;
    }
    ${doc} .message-body th {
      background: #f1f5f9 !important;
      font-weight: 700;
      text-align: left;
    }
    ${doc} .message-body th,
    ${doc} .message-body td {
      border: 1px solid #d1d5db;
      padding: 8px 12px;
      color: #111827 !important;
    }
    ${doc} .message-body tr:nth-child(even) td {
      background: #fafafa !important;
    }
    ${doc} .message-body .katex-mathml { display: none !important; }
    ${doc} .message-body .katex,
    ${doc} .message-body .katex-display {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    ${doc} .pdf-message-math-raster {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      page-break-inside: avoid !important;
      break-inside: avoid-page !important;
    }
    ${doc} .pdf-raster-slice {
      page-break-inside: avoid !important;
      break-inside: avoid-page !important;
    }
    ${doc} .pdf-raster-page-start {
      page-break-before: always !important;
      break-before: page !important;
    }
    ${doc} .pdf-math-raster,
    ${doc} .pdf-live-math {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0.5em 0 !important;
    }
    ${doc} .message-body .katex-display {
      display: block !important;
      width: 100% !important;
      margin: 0.9em 0 !important;
      padding: 4px 0 !important;
      overflow-x: auto !important;
      overflow-y: visible !important;
      clear: both !important;
      text-align: left !important;
      page-break-inside: avoid;
    }
    ${doc} .message-body .katex-display > .katex {
      display: block !important;
      text-align: left !important;
    }
    ${doc} .pdf-math-pending {
      display: inline-block;
      min-height: 1.1em;
      vertical-align: middle;
    }
    ${doc} .pdf-math-display {
      display: block !important;
      margin: 0.9em 0 !important;
      clear: both !important;
    }
    ${doc} .pdf-math-raster,
    ${doc} .pdf-table-raster {
      border: none;
      background: transparent;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    ${doc} .pdf-table-raster {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0.75em 0 !important;
    }
    ${doc} .msg-merge-sep {
      border: none;
      border-top: 1px dashed #e2e8f0;
      margin: 16px 0;
    }
    ${doc} .footer-note {
      text-align: center;
      font-size: 8pt;
      color: #9ca3af !important;
      padding: 24px 0 8px;
      border-top: 1px solid #e5e7eb;
      margin-top: 16px;
    }
    `;
  }

  function buildExportBodyHtml(messages, title) {
    const exportDate = new Date().toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const shortDate = new Date().toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const messagesHtml = messages
      .map((msg) => {
        const roleLabel =
          msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Qwen' : 'Message';
        const roleClass = msg.role === 'user' ? 'user' : 'assistant';
        return `
          <article class="message message-card ${roleClass}">
            <header class="message-header">
              <span class="message-role">${escapeHtml(roleLabel)}</span>
            </header>
            <div class="message-body">${msg.html}</div>
          </article>`;
      })
      .join('\n');

    return `
  <div class="cover">
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Exported ${escapeHtml(exportDate)}</p>
    <p class="meta">${messages.length} exchange${messages.length === 1 ? '' : 's'}</p>
    <p class="brand">Qwen Chat — PDF Export v${EXPORT_VERSION}</p>
  </div>
  <div class="doc-running-header">
    <span class="doc-title">${escapeHtml(title)}</span>
    <span class="doc-date">${escapeHtml(shortDate)}</span>
  </div>
  <div class="messages">
    ${messagesHtml}
  </div>
  <p class="footer-note">Generated by Qwen Chat to PDF Downloader</p>`;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildMathStylesheetLinks() {
    const links = [];
    const seen = new Set();
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.href || '';
      if (!href || seen.has(href)) return;
      if (/katex|mathjax|math/i.test(href)) {
        seen.add(href);
        links.push(`<link rel="stylesheet" href="${href}">`);
      }
    });
    links.push(
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">'
    );
    return links.join('\n');
  }

  function waitForImageLoad(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', () => reject(new Error('Image failed to load for PDF split.')), {
        once: true,
      });
    });
  }

  function findLightBreakRow(imgData, width, startY, idealY, range = 56) {
    const minY = Math.max(startY + 32, idealY - range);
    const maxY = Math.min(imgData.height - 2, idealY + range);
    let bestY = idealY;
    let bestScore = -1;
    const data = imgData.data;
    for (let y = minY; y <= maxY; y++) {
      let white = 0;
      let samples = 0;
      for (let x = 0; x < width; x += 3) {
        const i = (y * width + x) * 4;
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (lum > 246) white++;
        samples++;
      }
      const score = white / samples;
      if (score > bestScore) {
        bestScore = score;
        bestY = y;
      }
    }
    return bestY;
  }

  async function splitOversizedMessageRasters(doc, maxSlicePx = EXPORT_PAGE_CONTENT_HEIGHT_PX) {
    const images = [
      ...doc.querySelectorAll('img.pdf-message-math-raster:not(.pdf-raster-slice)'),
    ];

    for (const img of images) {
      try {
        await waitForImageLoad(img);
        const displayH = img.offsetHeight || img.clientHeight || 0;
        if (displayH <= maxSlicePx) continue;

        const canvas = doc.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const scale = img.naturalHeight / Math.max(displayH, 1);
        const maxSliceNatural = Math.floor(maxSlicePx * scale);
        const breakRows = [0];
        let y = 0;

        while (y + maxSliceNatural < canvas.height - 24) {
          const ideal = y + maxSliceNatural;
          const row = findLightBreakRow(imgData, canvas.width, y, ideal);
          const nextY = Math.max(
            y + Math.floor(maxSliceNatural * 0.5),
            Math.min(row, canvas.height - 24)
          );
          if (nextY <= y + 16) break;
          breakRows.push(nextY);
          y = nextY;
        }
        breakRows.push(canvas.height);

        if (breakRows.length <= 2) continue;

        const parent = img.parentNode;
        if (!parent) continue;

        const fragment = doc.createDocumentFragment();
        for (let i = 0; i < breakRows.length - 1; i++) {
          const y0 = breakRows[i];
          const h = breakRows[i + 1] - y0;
          const sliceCanvas = doc.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = h;
          sliceCanvas.getContext('2d').drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);

          const slice = doc.createElement('img');
          slice.src = sliceCanvas.toDataURL('image/png');
          slice.className = 'pdf-message-math-raster pdf-raster-slice';
          slice.alt = img.alt || 'Message content';
          if (i > 0) slice.classList.add('pdf-raster-page-start');
          fragment.appendChild(slice);
        }

        parent.replaceChild(fragment, img);
      } catch (err) {
        console.warn('[Qwen PDF] Raster page split failed:', err);
      }
    }
  }

  async function mountExportRoot(bodyHtml) {
    const existing = document.getElementById(EXPORT_ROOT_ID);
    if (existing) existing.remove();

    const fullDoc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
${buildMathStylesheetLinks()}
<style>${getExportStyles()}</style>
</head><body id="${EXPORT_BODY_ID}" class="${EXPORT_DOC_CLASS}">
${bodyHtml}
</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.id = EXPORT_ROOT_ID;
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: `${EXPORT_PAGE_WIDTH_PX}px`,
      border: 'none',
      zIndex: '2147483647',
      background: '#ffffff',
      opacity: '1',
      visibility: 'visible',
      pointerEvents: 'none',
    });

    document.body.appendChild(iframe);

    await new Promise((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error('Failed to load export document.'));
      iframe.srcdoc = fullDoc;
    });

    const iDoc = iframe.contentDocument;
    if (!iDoc?.getElementById(EXPORT_BODY_ID)) {
      throw new Error('Export document failed to initialize.');
    }

    try {
      if (iDoc.querySelector('table, [role="table"], .pdf-export-table')) {
        rebuildTablesInExportDoc(iDoc);
        mergeAdjacentSingleRowTables(iDoc.body);
      }
    } catch (err) {
      console.warn('[Qwen PDF] Export table prepare failed:', err);
    }

    try {
      const needsIframeMath =
        iDoc.querySelector('.katex, .katex-display') &&
        !iDoc.querySelector('.pdf-live-message-body');
      if (needsIframeMath) {
        await sleep(200);
        await flattenMathSectionsForPdf(iframe);
      }
    } catch (err) {
      console.warn('[Qwen PDF] Math prepare failed:', err);
    }

    try {
      await splitOversizedMessageRasters(iDoc);
    } catch (err) {
      console.warn('[Qwen PDF] Page slice prepare failed:', err);
    }

    await sleep(80);
    iframe.style.height = `${iDoc.documentElement.scrollHeight + 48}px`;

    return iframe;
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function generatePdfHtml(rootId, filename) {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_PDF_HTML',
      rootId,
      bodyId: EXPORT_BODY_ID,
      filename,
      pageWidth: EXPORT_PAGE_WIDTH_PX,
    });

    if (!response?.success) {
      throw new Error(response?.error || 'PDF generation failed.');
    }
  }

  async function generatePdfText(payload) {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_PDF_TEXT',
      payload,
    });

    if (!response?.success) {
      throw new Error(response?.error || 'PDF generation failed.');
    }
  }

  async function generatePdfCapture(payload) {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_PDF_CAPTURE',
      payload,
    });

    if (!response?.success) {
      throw new Error(response?.error || 'PDF generation failed.');
    }
  }

  function getCaptureNode(messageEl) {
    const markdownSel = MARKDOWN_LEAF_SELECTORS.join(', ');

    if (messageEl.matches?.(markdownSel) && isInMainChatColumn(messageEl)) {
      return /** @type {HTMLElement} */ (messageEl);
    }

    const outerMd = messageEl.closest(markdownSel);
    if (outerMd instanceof HTMLElement && isInMainChatColumn(outerMd)) {
      return outerMd;
    }

    if (isTurnWrapper(messageEl)) {
      return /** @type {HTMLElement} */ (messageEl);
    }

    const content = extractContentNode(messageEl);
    if (content) return content;

    for (const sel of CONTENT_SELECTORS) {
      try {
        const node = messageEl.querySelector(sel);
        if (node instanceof HTMLElement && hasSubstantiveContent(node)) return node;
      } catch {}
    }

    return /** @type {HTMLElement} */ (messageEl);
  }

  function validateExportMessages(messages) {
    const navHits = messages.filter((m) =>
      isNavigationLabel((m.text || '').slice(0, 80))
    ).length;

    if (navHits >= 8) {
      throw new Error(
        'Export captured the chat sidebar. Click your conversation in the center panel, refresh the page, then try again.'
      );
    }
  }

  async function handleExport(options = {}) {
    const hideSplash = options.skipSplash ? () => {} : showExportSplash('Preparing PDF…');

    try {
    const conversationRoot = getActiveConversationRoot();

    if (!conversationRoot) {
      throw new Error(
        'No chat container found. Open a conversation on chat.qwen.ai and try again.'
      );
    }

    if (options.autoScroll === true) {
      await autoScrollChat(conversationRoot, true);
    }

    const messageEls = findMessageElements(conversationRoot);

    if (!messageEls.length) {
      const hint = collectMarkdownBlocks(document.body).length
        ? 'Messages found but could not be parsed — try refreshing the page.'
        : 'Open an active conversation with visible messages, then try again.';
      throw new Error(`No messages detected. ${hint}`);
    }

    let lastRole = 'assistant';
    const entries = [];

    messageEls.forEach((el) => {
      const contentNode = extractContentNode(el) || el;
      const text = getMessagePlainText(contentNode);
      if (!text || text.length < 2) return;

      let role = detectRole(el);
      if (role === 'unknown') {
        role = isLikelyAssistantBlock(el)
          ? 'assistant'
          : lastRole === 'user'
            ? 'assistant'
            : 'user';
      }
      lastRole = role;

      let capId = null;
      const captureTarget = contentNode;
      if (contentNode.querySelector('.katex, .katex-display')) {
        capId = `live-${entries.length}`;
        captureTarget.setAttribute('data-qwen-pdf-live-cap', capId);
      }

      entries.push({ role, text, contentNode, captureTarget, capId });
    });

    const liveMarks = entries.filter((e) => e.capId).map((e) => ({ id: e.capId }));
    let liveCaptureMap = new Map();

    if (liveMarks.length) {
      try {
        liveCaptureMap = await captureLiveMessageBodies(liveMarks);
      } catch (err) {
        console.warn('[Qwen PDF] Live message capture failed:', err);
        entries.forEach((e) => {
          if (e.capId) e.captureTarget.removeAttribute('data-qwen-pdf-live-cap');
        });
      }
    }

    const messages = entries.map((entry, index) => {
      const cap = entry.capId ? liveCaptureMap.get(entry.capId) : null;
      let html;

      if (cap?.dataUrl && cap.hasInk !== false) {
        html = buildLiveMessageHtml(cap);
        entry.captureTarget.removeAttribute('data-qwen-pdf-live-cap');
      } else {
        if (entry.capId) entry.captureTarget.removeAttribute('data-qwen-pdf-live-cap');
        html = serializeMessageContent(entry.contentNode);
      }

      return {
        role: entry.role,
        text: entry.text,
        html,
        index,
      };
    });

    if (!messages.length) {
      throw new Error('Could not extract readable message content from this chat.');
    }

    const mergedMessages = mergeConsecutiveSameRole(messages);
    validateExportMessages(mergedMessages);

    const title = getChatTitle();
    const filename = sanitizeFilename(title);
    const exportDate = new Date().toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const totalText = mergedMessages.map((m) => m.text).join(' ').trim();
    if (totalText.length < 10) {
      throw new Error(
        'Export produced no readable text. Refresh the chat page and try again.'
      );
    }

    let exportMode = 'html';
    const bodyHtml = buildExportBodyHtml(mergedMessages, title);
    const exportHost = await mountExportRoot(bodyHtml);

    try {
      await waitForPaint();
      await generatePdfHtml(EXPORT_ROOT_ID, filename);
    } catch (htmlErr) {
      console.warn('[Qwen PDF] HTML export failed, using text fallback:', htmlErr);
      await generatePdfText({
        title,
        filename,
        exportDate,
        messages: mergedMessages.map(({ role, text }) => ({ role, text })),
      });
      exportMode = 'text';
    } finally {
      exportHost.remove();
    }

    chrome.runtime.sendMessage({
      type: 'EXPORT_LOG',
      payload: {
        filename,
        count: mergedMessages.length,
        mode: exportMode,
        version: EXPORT_VERSION,
      },
    });

    return {
      success: true,
      filename,
      messageCount: mergedMessages.length,
      title,
      version: EXPORT_VERSION,
    };
    } finally {
      hideSplash();
    }
  }

  const EXTENSION_LOGO_URL = chrome.runtime.getURL('icons/logo.png');

  function showExportSplash(label = 'Preparing PDF…') {
    let splash = document.getElementById(EXPORT_SPLASH_ID);
    if (!splash) {
      splash = document.createElement('div');
      splash.id = EXPORT_SPLASH_ID;
      splash.setAttribute('data-qwen-pdf-ui', 'true');
      splash.innerHTML = `
        <div class="splash-card">
          <div class="splash-orbs" aria-hidden="true"><span></span><span></span><span></span></div>
          <p class="splash-label"></p>
          <div class="splash-bar" aria-hidden="true"></div>
        </div>`;
      document.body.appendChild(splash);
    }
    const text = splash.querySelector('.splash-label');
    if (text) text.textContent = label;
    splash.classList.add('is-active');
    return () => splash.classList.remove('is-active');
  }

  function setOverlayStatus(root, type, message) {
    const el = root.querySelector('.qwen-pdf-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'qwen-pdf-status';
    if (type) el.classList.add(`is-${type}`);
  }

  function setOverlayLoading(root, loading) {
    root.classList.toggle('is-exporting', loading);
    const cta = root.querySelector('.qwen-pdf-cta');
    const fab = root.querySelector('.qwen-pdf-fab');
    if (cta) cta.disabled = loading;
    if (fab) fab.disabled = loading;
    const text = root.querySelector('.qwen-pdf-cta-text');
    if (text) text.textContent = loading ? 'Preparing PDF…' : 'Download Chat as PDF';
  }

  function setOverlayPanelOpen(root, open) {
    root.classList.toggle('is-panel-open', open);
    const panel = root.querySelector('.qwen-pdf-panel');
    if (panel) panel.hidden = !open;
  }

  async function runOverlayExport(root) {
    const autoScroll = !!root.querySelector('#qwen-pdf-autoscroll')?.checked;
    setOverlayLoading(root, true);
    setOverlayStatus(root, 'info', 'Building your PDF…');
    const hideSplash = showExportSplash('Preparing PDF…');

    try {
      const result = await handleExport({ autoScroll, skipSplash: true });
      setOverlayStatus(
        root,
        'success',
        `Downloaded "${result.filename}" (${result.messageCount} messages).`
      );
    } catch (err) {
      setOverlayStatus(root, 'error', err?.message || 'PDF export failed.');
    } finally {
      hideSplash();
      setOverlayLoading(root, false);
    }
  }

  function mountChatOverlay() {
    if (document.getElementById(OVERLAY_ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    root.className = 'qwen-pdf-overlay';
    root.setAttribute('data-qwen-pdf-ui', 'true');
    root.innerHTML = `
      <button type="button" class="qwen-pdf-fab" title="Export chat to PDF" aria-label="Export chat to PDF">
        <img class="qwen-pdf-fab-logo" src="${EXTENSION_LOGO_URL}" alt="" width="52" height="52" />
      </button>
      <div class="qwen-pdf-panel" hidden role="dialog" aria-label="Export chat to PDF">
        <div class="qwen-pdf-panel-header">
          <div class="qwen-pdf-panel-title">
            <img class="qwen-pdf-panel-logo" src="${EXTENSION_LOGO_URL}" alt="" width="32" height="32" />
            <span class="qwen-pdf-wordmark">qwen<span>pdf</span></span>
            <span class="qwen-pdf-badge">v1</span>
          </div>
          <button type="button" class="qwen-pdf-close" aria-label="Close">×</button>
        </div>
        <p class="qwen-pdf-tagline">Download this conversation as a landscape PDF.</p>
        <label class="qwen-pdf-check">
          <input type="checkbox" id="qwen-pdf-autoscroll" />
          <span>Scroll to load full chat history before export</span>
        </label>
        <button type="button" class="qwen-pdf-cta">
          <span class="fluid-loader" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="qwen-pdf-cta-text">Download Chat as PDF</span>
        </button>
        <p class="qwen-pdf-status" role="status" aria-live="polite"></p>
      </div>`;

    const fab = root.querySelector('.qwen-pdf-fab');
    const closeBtn = root.querySelector('.qwen-pdf-close');
    const cta = root.querySelector('.qwen-pdf-cta');
    const panel = root.querySelector('.qwen-pdf-panel');

    fab?.addEventListener('click', () => setOverlayPanelOpen(root, true));
    closeBtn?.addEventListener('click', () => setOverlayPanelOpen(root, false));
    cta?.addEventListener('click', () => runOverlayExport(root));

    panel?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOverlayPanelOpen(root, false);
    });

    document.body.appendChild(root);
  }

  function initChatOverlay() {
    const boot = () => {
      if (!document.body) return;
      mountChatOverlay();
    };

    boot();

    const observer = new MutationObserver(() => {
      if (!document.getElementById(OVERLAY_ROOT_ID) && document.body) {
        mountChatOverlay();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatOverlay, { once: true });
  } else {
    initChatOverlay();
  }
})();
