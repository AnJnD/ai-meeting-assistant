# AI Meeting Assistant - Hướng dẫn sử dụng

## Tool này là gì?

AI Meeting Assistant là extension (tiện ích mở rộng) cài trên trình duyệt Google Chrome, giúp bạn:

- **Ghi lại lời nói** trong cuộc họp Google Meet hoặc Microsoft Teams theo thời gian thực
- **Phân biệt người nói** — hiện tên từng người trong transcript
- **Tạo biên bản họp (議事録)** bằng AI — chỉ cần 1 nút bấm, AI sẽ tóm tắt và trình bày theo format chuyên nghiệp chuẩn công ty Nhật

---

## Bước 1: Cài đặt Extension lên Chrome

1. Mở trình duyệt **Google Chrome**
2. Vào địa chỉ: `chrome://extensions`
3. Bật **Developer mode** (chế độ nhà phát triển) — công tắc nằm ở góc trên bên phải
4. Bấm nút **"Load unpacked"** (Tải tiện ích đã giải nén)
5. Chọn thư mục `ai-meeting-assistant-v2.0` (thư mục chứa các file `manifest.json`, `background.js`, ...)
6. Extension sẽ xuất hiện trong danh sách — bạn sẽ thấy icon trên thanh công cụ Chrome

> 💡 Mẹo: Bấm vào icon hình ghim (puzzle piece) trên thanh Chrome, rồi ghim "AI Meeting Assistant v2" để dễ truy cập.

---

## Bước 2: Lấy API Key (miễn phí)

Extension cần 1 API key của Google Gemini để AI hoạt động. Cách lấy:

1. Vào trang: **https://aistudio.google.com/apikey**
2. Đăng nhập bằng tài khoản Google của bạn
3. Bấm **"Create API Key"** (Tạo khóa API)
4. Copy dãy ký tự bắt đầu bằng `AIza...`

> ⚠️ Lưu ý: Key này miễn phí với giới hạn sử dụng nhất định mỗi ngày. Đủ dùng cho cuộc họp bình thường.

---

## Bước 3: Cấu hình API Key trong Extension

1. Bấm vào icon Extension trên thanh Chrome
2. Chọn tab **"Settings"**
3. Ở mục Provider, chọn **"Google Gemini"**
4. Dán API Key vừa copy vào ô **"Gemini API Key"**
5. Bấm **Save**
6. (Tùy chọn) Bấm **"Kiểm tra API Key"** để xác nhận key hoạt động — sẽ hiện model đang dùng

---

## Bước 4: Sử dụng trong cuộc họp

### 4.1. Vào phòng họp

- Mở **Google Meet** (meet.google.com) hoặc **Microsoft Teams** (teams.microsoft.com)
- Tham gia cuộc họp bình thường

### 4.2. Bật phụ đề (Caption) trên nền tảng họp

**Google Meet:**
- Bấm nút **CC** (hoặc "Turn on captions") ở thanh điều khiển phía dưới màn hình

**Microsoft Teams:**
- Bấm **"..." (More)** → **"Turn on live captions"** (Bật phụ đề trực tiếp)

> ⚠️ Quan trọng: Extension đọc phụ đề từ nền tảng để ghi transcript. Nếu không bật CC, extension sẽ dùng mic (độ chính xác thấp hơn và không nghe được tiếng của khách hàng).

### 4.3. Bắt đầu ghi

1. Bấm vào icon Extension
2. Bấm **"Start AI Assistant"**
3. Một cửa sổ nhỏ (overlay) sẽ hiện lên góc màn hình
4. Transcript bắt đầu hiển thị theo thời gian thực

### 4.4. Các nút trong overlay

| Nút | Chức năng |
|-----|-----------|
| **Copy** | Copy nội dung transcript vào clipboard |
| **DL Script** | Tải transcript về máy dạng file .txt |
| **Xóa** | Xóa transcript hiển thị (dữ liệu tích lũy vẫn giữ) |
| **Reset** (nút đỏ) | Xóa TOÀN BỘ dữ liệu đã tích lũy — không phục hồi được |
| **Tạo 議事録** | AI tạo biên bản họp từ transcript |
| **Copy** (ở 議事録) | Copy biên bản họp |
| **DL MM** | Tải biên bản họp về máy dạng file .txt |
| **Xóa** (ở 議事録) | Xóa nội dung biên bản họp vừa tạo |

### 4.5. Tạo biên bản họp (議事録)

1. Để cuộc họp diễn ra — transcript sẽ tự động tích lũy
2. Khi muốn tạo biên bản, bấm **"Tạo 議事録"**
3. Đợi 10-30 giây để AI xử lý
4. Kết quả hiện thị ngay trong overlay
5. Bấm **Copy** hoặc **DL MM** để lưu lại

---

## Các tính năng đặc biệt

### Standby Mode (Tự động ghi ngầm)

- Khi bạn mở trang Google Meet hoặc Teams, extension tự động bắt đầu theo dõi phụ đề ngầm
- Bạn không cần bấm "Start" — dữ liệu đã được ghi từ lúc bắt đầu họp
- Khi bạn bấm "Start", toàn bộ dữ liệu trước đó sẽ hiện lên ngay

### Tự động lưu

- Transcript được tự động lưu mỗi 15 giây
- Nếu bạn tắt trình duyệt rồi mở lại (trong vòng 6 tiếng), dữ liệu vẫn còn

### Tự động chọn model AI mới nhất

- Extension tự động detect và sử dụng model Gemini Flash mới nhất
- Khi Google ra model mới, không cần update extension

---

## Câu hỏi thường gặp

**Q: Tại sao transcript không hiện gì?**
- Kiểm tra đã bật Caption/Phụ đề trên Meet hoặc Teams chưa
- Thử bấm nút "Reload" trong overlay

**Q: Bấm "議事録作成" bị lỗi?**
- Kiểm tra API key đã lưu đúng chưa (vào Settings → Kiểm tra API Key)
- Nếu hiện "quota hết" — đợi 1 phút rồi thử lại, hoặc tạo API key mới

**Q: Có an toàn không? Dữ liệu đi đâu?**
- Transcript chỉ lưu trên máy của bạn (trong Chrome storage)
- Chỉ khi bạn bấm "議事録作成", nội dung mới được gửi lên Gemini API để xử lý
- Không có server trung gian nào

**Q: Dùng được trên máy tính nào?**
- Bất kỳ máy tính nào có Google Chrome (Windows, Mac, Linux)
- Không hỗ trợ trình duyệt khác (Firefox, Safari, Edge)

---

## Tổng kết các bước

```
1. Cài extension vào Chrome (Load unpacked)
2. Lấy API key tại aistudio.google.com/apikey
3. Dán key vào Settings của extension
4. Vào họp, bật Caption
5. Bấm Start → transcript tự chạy
6. Cuối họp bấm "議事録作成" → AI tạo biên bản
7. Copy hoặc Download kết quả
```
