# AI Meeting Assistant (v7.1)

Chrome extension hỗ trợ cuộc họp tiếng Nhật trên **Google Meet / Microsoft Teams / Zoom (web)**:
ghi transcript realtime theo từng người nói, **ghi hình cuộc họp (Tab hoặc Màn hình)**, xem lại trong
**Thư viện bản ghi** và tạo biên bản họp (議事録) bằng AI (Gemini / OpenAI / DeepSeek).

## Tính năng chính

### Transcript
- **Transcript realtime**: đọc phụ đề (CC) của Meet / Teams / Zoom và tách theo từng người nói. Hỗ trợ tên Latin, Kanji, Katakana, Korean và tên có tiền tố như `(OMN) Nguyen Van A`.
- **Standby Mode**: mở trang họp là extension tự bắt phụ đề ngầm, không cần bấm gì.
- **Live Translate (mặc định TẮT)**: tab **Translate** dịch transcript sang tiếng Việt. Chỉ chạy khi bạn tự bật công tắc, và chỉ cho cuộc họp đang mở.
- **Tự động lưu**: transcript được lưu liên tục và khôi phục khi mở lại popup hoặc khi extension tự nạp lại.

### Ghi hình (tab Record)
- **Nguồn ghi**: Tab, Màn hình / Cửa sổ, hoặc Chỉ tiếng. Chất lượng 720p / 1080p / 2K.
- **Đổi nguồn giữa chừng, vẫn ra một video**: ví dụ đang ghi tab Teams thì chuyển sang ghi tab hoặc màn hình đang share. Hình lấy từ phần share, tiếng vẫn lấy từ tab Teams. Bấm **Dừng chia sẻ** của Chrome là tự quay lại ghi tab họp.
- **Kèm micro**: chọn micro cụ thể. Micro **tự tắt theo nút mic trong cuộc họp**, nên lúc bạn mute thì bản ghi không thu giọng bạn.
- **Đánh dấu khoảnh khắc**: bấm **Đánh dấu** hoặc phím tắt **Alt+Shift+K**.
- **AI chép lời trong lúc ghi** (tuỳ chọn) và **nhận diện tên người nói từ màn hình họp** (Gemini).
- Khi đang ghi, icon extension có **chấm đỏ nhỏ**.

### Thư viện bản ghi
- **Phát lại** video / âm thanh, với **transcript khớp video**: bấm vào một câu là nhảy tới đúng đoạn đó.
- **Tạo transcript bằng AI** từ âm thanh (Gemini / OpenAI), đổi tên người nói, và **Dịch VI** dưới mỗi câu.
- **Hỏi AI** về bản ghi. Câu trả lời có trích mốc `[mm:ss]`, bấm vào là nghe lại đúng đoạn đó.
- **議事録** từ bản ghi, tải về .txt / .docx.
- **Tải xuống** video (.mp4 / .webm), âm thanh và transcript.
- **Script cuộc họp**: transcript + 議事録 của cả những phiên **không ghi hình**.
- **Tự dọn**: giữ tối đa **15 bản ghi** và **15 script** gần nhất, mỗi bản tối đa **7 ngày**. Mỗi bản có nhãn hạn xoá ("Xoá sau: 3 ngày", "Xoá khi có bản mới").

### AI
- **Nhà cung cấp**: Gemini, OpenAI, DeepSeek. Có thể bật **Failover** để tự chuyển sang nhà cung cấp khác khi một bên lỗi.
- **Tự chọn model mới nhất**: biên bản dùng bản Flash mới nhất, Live Translate dùng bản rẻ nhất.
- **API key chỉ cần cho các tính năng AI** (Summary, 議事録, Dịch, Hỏi AI, chép lời bằng AI). Bắt transcript và ghi hình **không cần key**.
- **DeepSeek không nhận âm thanh**, nên chép lời bằng AI cần key Gemini hoặc OpenAI.

## Nền tảng hỗ trợ

| Nền tảng | Transcript | Ghi hình |
|---|---|---|
| Google Meet (web) | Đọc CC từ DOM | Tab / Màn hình |
| Microsoft Teams (web) | Đọc CC từ DOM | Tab / Màn hình |
| Zoom (web client) | Đọc CC từ DOM | Tab / Màn hình |
| App Teams / Zoom cài trên máy | Tạo bằng AI từ bản ghi | Màn hình (bật "Chia sẻ âm thanh hệ thống") |

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked** rồi chọn thư mục `ai-meeting-assistant/`.
3. (Tuỳ chọn, cho tính năng AI) Bấm icon extension → tab **Settings** → chọn Provider → dán API key → **Save** → **Kiểm tra API Key**.
   - Gemini: [Google AI Studio](https://aistudio.google.com/apikey)
   - OpenAI: platform.openai.com
   - DeepSeek: platform.deepseek.com
4. Lần đầu ghi kèm micro, extension mở một trang để bạn **cấp quyền micro một lần**.

> **Cập nhật hoặc reload extension giữa cuộc họp:** không cần F5 trang họp (F5 sẽ làm bạn rời cuộc họp). Extension tự nạp lại vào các tab họp đang mở.

## Sử dụng

1. Vào cuộc họp và **bật phụ đề (CC)**.
2. Bấm icon extension → tab **Control** → **Bắt đầu**. Một bảng chọn hiện ra, chọn sẵn **Tab + 1080p + micro**. Bấm **Bắt đầu** lần nữa là ghi ngay, hoặc chọn **Màn hình** / **Không ghi**.
3. Header popup chỉ hiện 2 khối:
   - `[● 12:34]` **xanh lá**: đang chép transcript. Chuyển **vàng** `II` khi tạm dừng.
   - `[● Tab 12:34]` / `[● Màn hình 12:34]` **đỏ**: đang ghi hình. Bấm vào để sang tab Record, đổi nguồn ở đó.
4. **Control là bảng chính**:
   - **Tạm dừng / Tiếp tục**: transcript và bản ghi cùng dừng, cùng chạy.
   - Tạm dừng ở tab Record thì chỉ bản ghi dừng, Control không bị ảnh hưởng.
5. Nút **Tải** ở Control tải cả **script và video** của cuộc họp đang diễn ra.
6. Bấm **議事録** để AI viết biên bản. Bấm **Translate** để xem bản dịch tiếng Việt.
7. Bấm **Kết thúc**: bản ghi được dừng và lưu vào **Thư viện**, rồi Control và Record được reset cho phiên mới.
8. Xem lại sau họp: **Settings → Lịch sử cuộc họp → Mở Thư viện bản ghi**, hoặc nút Thư viện ở tab Record.

Hướng dẫn chi tiết (tiếng Việt): [`ai-meeting-assistant/HUONG_DAN_SU_DUNG.md`](ai-meeting-assistant/HUONG_DAN_SU_DUNG.md)

## Cấu trúc thư mục

```
ai-meeting-assistant/
├── manifest.json          # Chrome extension manifest (MV3)
├── background.js          # Service worker: gọi AI, điều phối ghi hình, icon/badge, nạp lại content script
├── content.js             # Content script: đọc CC, Standby, lưu transcript, theo dõi nút mic cuộc họp
├── popup.html / popup.js  # Popup: Control, Transcript, Translate, Settings, bảng Bắt đầu
├── popup-record.js        # Tab Record: nguồn ghi, đổi nguồn, Tạm dừng / Dừng
├── offscreen.html / .js   # Bộ ghi (MediaRecorder) chạy trong offscreen document, trộn tiếng, đổi nguồn
├── recordings.html / .js  # Thư viện bản ghi: phát lại, transcript, Hỏi AI, 議事録, Script cuộc họp
├── rec-db.js              # Lưu bản ghi trong IndexedDB, tự dọn (15 bản / 7 ngày)
├── rec-shared.js          # Hằng số & hàm dùng chung (chất lượng, giới hạn, định dạng)
├── ai-audio.js            # Chép lời bằng AI từ âm thanh (Gemini / OpenAI)
├── docx.js                # Xuất 議事録 ra .docx
├── mic-permission.html/.js# Trang xin quyền micro một lần
├── styles.css
└── icons/
test/                      # Bộ kiểm thử Node (node test/<tên>-check.mjs)
```

## Kiểm thử

```bash
node test/meet-cc-check.mjs
node test/techlead-check.mjs
node test/translate-check.mjs
node test/zoom-cc-check.mjs
```

## Quyền riêng tư & bảo mật

- Transcript, bản ghi và 議事録 **chỉ lưu trên máy** (Chrome storage / IndexedDB). Không có server trung gian. Xoá extension thì dữ liệu cũng mất, nên hãy **tải về** những gì cần giữ.
- **Chỉ gọi API AI khi bạn chủ động bấm** (Summary, 議事録, Dịch, Hỏi AI, Tạo transcript bằng AI), hoặc khi bạn tự bật "AI chép lời trong lúc ghi".
- Standby chỉ chạy trên 5 domain: `meet.google.com`, `teams.microsoft.com`, `teams.live.com`, `app.zoom.us`, `zoom.us`.
- Người tham gia **không được thông báo** khi bạn ghi bằng extension. Hãy xin phép trước khi ghi.

## Đóng góp

- **Không push thẳng vào `main`.** Tạo nhánh `feature/<tên>-<việc>` hoặc `fix/<tên>-<lỗi>`, push lên rồi mở Pull Request vào `main`.
- Chạy 4 bộ test ở trên trước khi mở PR.

## License

Private use only.
