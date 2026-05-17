<img width="813" height="752" alt="image" src="https://github.com/user-attachments/assets/d97ba905-ab04-4769-a345-4bdfd242189b" /># Qwen Chat to PDF Downloader

Chrome extension (Manifest V3) that exports your full [chat.qwen.ai](https://chat.qwen.ai) conversation as a professionally formatted A4 PDF.

## Features

- One-click export from the extension popup
- Extracts visible user and Qwen messages with markdown formatting (headings, lists, code, tables)
- Auto-scrolls the chat to load lazy-loaded messages before export
- A4 multi-page PDF with cover page, role labels, and page numbers (jsPDF text layout — reliable on all pages)
- Filename from conversation title + export date
- Clear success and error feedback in the popup
<img width="1911" height="843" alt="image" src="https://github.com/user-attachments/assets/21f5ed27-3f43-48d6-8165-23c88a5077b8" />
<img width="1152" height="538" alt="image" src="https://github.com/user-attachments/assets/c7ead8af-4070-43f4-bef4-04864e16abca" />
<img width="1918" height="840" alt="image" src="https://github.com/user-attachments/assets/39e55f47-68e3-477a-ae42-ce4c07a7c41f" />
<img width="1181" height="658" alt="image" src="https://github.com/user-attachments/assets/ece12799-ac01-4b81-ba42-e2dec6fefc81" />
<img width="813" height="752" alt="image" src="https://github.com/user-attachments/assets/7a7dad64-8d72-4557-8bd7-107f613cacf8" />



## Project structure

```
qwen-chat-pdf-extension/
├── manifest.json
├── popup.html / popup.js / styles.css
├── content.js
├── background.js
├── libs/html2pdf.bundle.min.js
└── icons/ (16, 48, 128)
```

## Install in Chrome (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `qwen-chat-pdf-extension`
5. Pin the extension from the puzzle icon for quick access

## How to use

1. Go to [https://chat.qwen.ai](https://chat.qwen.ai) and open a conversation
2. Wait for messages to finish loading (scroll if needed)
3. Click the extension icon in the toolbar
4. Click **Download Chat as PDF**
5. The PDF saves to your default Downloads folder

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Interact with the current Qwen chat tab when you click the extension |
| `scripting` | Re-inject the content script if needed |
| `downloads` | Save the generated PDF to your Downloads folder |
| `host_permissions` (`chat.qwen.ai`) | Inject the content script and load the PDF library on Qwen only |

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| “Navigate to chat.qwen.ai” | Open an active chat on `https://chat.qwen.ai/*` |
| “No messages detected” | Refresh the page; ensure the chat has messages visible |
| “Could not reach the page” | Reload the tab after installing/updating the extension |
| PDF is empty or cut off | Reload the extension (v1.1+ uses text-based PDF, not screenshots). Refresh chat and retry |
| Very long chats time out | Export after loading the portion you need, or split the chat |

## Development

- Plain JavaScript, no build step
- Replace `libs/html2pdf.bundle.min.js` from [cdnjs html2pdf.js](https://cdnjs.com/libraries/html2pdf.js) to upgrade the PDF engine
- Icons are in `icons/` (16×16, 48×48, 128×128 PNG)

## License

Use and modify freely for personal or commercial projects.
