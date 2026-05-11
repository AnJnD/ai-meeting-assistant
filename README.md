# AI Meeting Assistant

Chrome extension hỗ trợ cuộc họp tiếng Nhật — ghi transcript realtime từ Google Meet / Microsoft Teams, phân tách người nói, và tạo biên bản họp (議事録) bằng AI.

## Tính năng chính

- **Transcript realtime** — Đọc phụ đề (CC) từ Google Meet / Microsoft Teams, hiển thị theo từng người nói
- **Phân biệt người nói** — Tự động tách tên người nói (hỗ trợ tên Latin, Kanji, Katakana, Korean)
- **Standby Mode** — Tự động ghi ngầm ngay khi mở trang họp, không cần bấm Start
- **Tạo 議事録** — AI tạo biên bản họp chuẩn format công ty Nhật chỉ với 1 nút bấm
- **Tự động chọn model mới nhất** — Luôn sử dụng Gemini Flash phiên bản mới nhất
- **Tự động lưu** — Transcript được lưu mỗi 15 giây, phục hồi khi reload trang

## Nền tảng hỗ trợ

| Nền tảng | Cách hoạt động |
|----------|---------------|
| Google Meet | Đọc caption từ DOM |
| Microsoft Teams | Đọc caption từ DOM |
| Trang khác | Web Speech API (mic) |

## Cài đặt

### 1. Cài Extension

1. Mở Google Chrome → vào `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **"Load unpacked"**
4. Chọn thư mục `ai-meeting-assistant/`

### 2. Lấy API Key

1. Vào [Google AI Studio](https://aistudio.google.com/apikey)
2. Bấm **"Create API Key"**
3. Copy key (bắt đầu bằng `AIza...`)

### 3. Cấu hình

1. Bấm icon extension → tab **Settings**
2. Chọn Provider: **Google Gemini**
3. Dán API Key → bấm **Save**
4. Bấm **"Kiểm tra API Key"** để xác nhận

## Sử dụng

1. Vào cuộc họp trên Google Meet hoặc Microsoft Teams
2. Bật phụ đề (CC) trên nền tảng họp
3. Bấm icon extension → **"Start AI Assistant"**
4. Transcript hiển thị realtime trong overlay
5. Khi cần biên bản họp → bấm **"議事録作成"**

## Cấu trúc thư mục

```
ai-meeting-assistant/
├── manifest.json      # Chrome extension manifest (MV3)
├── background.js      # Service worker — xử lý API calls
├── content.js         # Content script — UI overlay + caption scraping
├── popup.html         # Popup settings UI
├── popup.js           # Popup logic
├── styles.css         # Overlay styles
└── HUONG_DAN_SU_DUNG.md  # Hướng dẫn chi tiết (tiếng Việt)
```

## Công nghệ

- **Chrome Extension Manifest V3**
- **Google Gemini Flash API** (tự động detect bản mới nhất)
- **MutationObserver** — theo dõi caption DOM realtime
- **Web Speech API** — fallback khi không có CC
- **Chrome Storage API** — lưu transcript + settings

## Bảo mật

- Transcript chỉ lưu trên máy local (Chrome storage)
- Chỉ gọi API khi user chủ động bấm "議事録作成"
- Không có server trung gian
- Extension chỉ active trên 3 domain: `meet.google.com`, `teams.microsoft.com`, `teams.live.com`

## License

Private use only.
