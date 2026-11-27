# AI Meeting Assistant - Hướng dẫn sử dụng

## Tool này là gì?

AI Meeting Assistant là extension (tiện ích mở rộng) cài trên trình duyệt Google Chrome, giúp bạn:

- **Ghi lại lời nói** trong cuộc họp Google Meet, Microsoft Teams hoặc Zoom theo thời gian thực
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

- Mở **Google Meet** (meet.google.com), **Microsoft Teams** (teams.microsoft.com) hoặc **Zoom** (app.zoom.us — tham gia qua trình duyệt)
- Tham gia cuộc họp bình thường

### 4.2. Bật phụ đề (Caption) trên nền tảng họp

**Google Meet:**
- Bấm nút **CC** (hoặc "Turn on captions") ở thanh điều khiển phía dưới màn hình

**Microsoft Teams:**
- Bấm **"..." (More)** → **"Turn on live captions"** (Bật phụ đề trực tiếp)

**Zoom (web client):**
- Bấm **"Live Transcript"** (hoặc **"CC"**) ở thanh điều khiển phía dưới → chọn **"Enable"**

> ⚠️ Quan trọng: Extension đọc phụ đề từ nền tảng để ghi transcript. Nếu không bật CC, extension sẽ dùng mic (độ chính xác thấp hơn và không nghe được tiếng của khách hàng).

**Kiểm tra bằng icon CC trong popup** (cạnh tên nền tảng, ở hàng Transcript / Translate):

| Icon | Nghĩa |
|------|-------|
| **CC** xanh | Đã tìm thấy khung phụ đề của nền tảng — đang đọc trực tiếp từ CC |
| **CC** gạch chéo | Chưa bật CC (hoặc đã tắt giữa buổi) — extension đang dùng Microphone |

Bật CC giữa buổi thì icon tự chuyển sang xanh trong vài giây, không cần bấm Reload. Ngược lại, tắt CC giữa buổi thì sau vài giây icon quay về gạch chéo và extension tự chuyển sang mic.

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

### 4.5. Xem bản dịch tiếng Việt (tab Translate)

Ngay cạnh tab **Transcript** có tab **Translate**. Bấm vào là xem được bản dịch tiếng Việt của đúng những gì đang hiện bên Transcript.

> ⚠️ **Mặc định tính năng này TẮT.** Mở tab Translate KHÔNG tự dịch và không gọi API lần nào — phải tự bật công tắc mới dịch. Công tắc chỉ có hiệu lực cho **cuộc họp đang mở**: cuộc họp sau lại về trạng thái tắt, nên không bao giờ có chuyện dịch âm thầm đốt token.

1. Bấm tab **Translate**, rồi bật công tắc **Đã tắt → Đang bật** ở góc dưới bên trái — từ lúc đó mới dịch phần đang có và tự dịch tiếp mỗi khi có người nói thêm
2. Trình bày giống hệt bên Transcript: `Tên người nói: nội dung đã dịch`. Tên người nói **giữ nguyên**, không dịch
3. Câu đang nói dở (chữ xanh in nghiêng) hiển thị bản gốc — dịch ngay khi câu chốt lại
4. **Copy** / **Tải** dùng y như bên Transcript
5. **Dịch lại** — dịch lại toàn bộ từ đầu (khi thấy bản dịch chưa vừa ý)
6. **Dịch phần cũ (N)** — hiện khi có phần chưa dịch: phần ghi trong lúc công tắc tắt, hoặc phần cũ bị hoãn khi bạn bật dịch giữa một cuộc họp đã dài. Bấm nút này nếu thực sự cần dịch bù (tốn token)
7. Tắt công tắc bất cứ lúc nào — lô đang gửi vẫn nhận kết quả (đã trả tiền rồi), còn phần chờ thì dừng lại, không gọi thêm API

| Điều cần biết | Chi tiết |
|---------------|----------|
| Dùng API key nào? | Chính key AI đã cài trong Settings (Gemini / OpenAI / DeepSeek), có cả failover |
| Model nào? | Bản rẻ và nhanh nhất mà key của bạn có (Flash-Lite / mini). Tự nhận model mới khi nhà cung cấp ra bản mới, không cần cập nhật extension. Bấm **Test** trong Settings để xem đang dùng model gì |
| Công tắc mặc định? | **Tắt.** Chỉ bật khi bạn tự bấm, và chỉ cho cuộc họp đang mở. Bấm **Xóa transcript** cũng đưa công tắc về tắt |
| Popup đóng thì sao? | Việc dịch tạm dừng (Chrome huỷ popup). Mở lại popup **trong cùng cuộc họp** thì công tắc giữ nguyên trạng thái bạn đã chọn và dịch tiếp phần còn thiếu |
| Có dịch lại phần cũ không? | Không. Bản dịch được cache theo từng câu và dùng chung mọi cuộc họp — câu lặp lại (「はい」,「そうですね」) không tốn thêm token |
| Dòng nào không tốn API? | Dòng chỉ có số/dấu câu, và dòng vốn đã là tiếng Việt — được giữ nguyên, không gửi lên AI |
| Tốn quota nhiều không? | Gộp tới ~1200 ký tự mỗi lần gọi, chạy 3 lô song song. Tiết kiệm khoảng 60–75% so với bản 4.5 |
| Nếu API lỗi / không phản hồi? | Thử lại tối đa 3 lần rồi dừng và hiện **bản gốc** để bạn vẫn đọc được, kèm cảnh báo ⚠. Bấm **Dịch lại** để thử tiếp |

### 4.6. Tạo biên bản họp (議事録)

1. Để cuộc họp diễn ra — transcript sẽ tự động tích lũy
2. Khi muốn tạo biên bản, bấm **"Tạo 議事録"**
3. Đợi 10-30 giây để AI xử lý
4. Kết quả hiện thị ngay trong overlay
5. Bấm **Copy** hoặc **DL MM** để lưu lại

### 4.7. Ghi hình / ghi âm cuộc họp (tab Record) — mới ở bản 5.0

> ⚠️ **Người tham gia KHÔNG được thông báo** khi bạn ghi bằng extension (khác với nút Record có sẵn của Meet/Teams/Zoom). Hãy xin phép mọi người trước khi ghi.

1. Bấm icon extension → tab **Record** → chọn **Nguồn ghi**:
   - **Tab này**: ghi tab Chrome đang mở (Meet / Teams / Zoom bản web…). Không cần chọn gì thêm, có sẵn tiếng của tab
   - **Màn hình / cửa sổ** (bản 5.2): sau khi bấm *Bắt đầu ghi*, Chrome hỏi bạn chọn **Toàn màn hình**, **Cửa sổ** hoặc **Tab**. Dùng để ghi **app Teams/Zoom cài trên máy**, slide, phần mềm khác…
2. Chọn chế độ:
   - **Hình + tiếng**: ghi video của tab (720p / 1080p / 2K)
   - **Chỉ tiếng**: chỉ ghi âm thanh của tab (file nhỏ, hợp cho podcast / bài giảng)
3. **Ghi kèm micro của tôi** (bật sẵn): tiếng của tab chỉ có giọng người khác, nên cần micro để bản ghi có cả giọng bạn. Lần đầu, extension mở một trang để bạn **cấp quyền micro một lần**. Cấp xong thì quay lại tab cuộc họp và bấm ghi lại
   - **Micro** (bản 5.4): chọn micro cụ thể (tai nghe, micro USB…). Lựa chọn được nhớ. Nếu lúc ghi không thấy micro đó (đã rút ra), extension dùng micro mặc định và báo trong popup. Tên micro chỉ hiện sau khi đã cấp quyền micro
4. **Định dạng** (bản 5.4, chỉ khi ghi hình):
   - **MP4 (H.264)** — mặc định. Card đồ hoạ thường nén hộ nên **nhẹ máy**, ít làm cuộc họp bị giật. File mở được ở mọi trình phát, gửi qua Slack/Teams/email dễ dàng
   - **WebM (VP9)** — nét hơn ở cùng dung lượng nhưng nén bằng CPU, tốn máy hơn
5. Bấm **Bắt đầu ghi**. Icon extension hiện chữ **REC** đỏ, popup có đồng hồ đếm giờ. **Đóng popup thì việc ghi vẫn tiếp tục**
6. **Tạm dừng / Tiếp tục** tuỳ ý. Phần tạm dừng không có trong file
7. **📌 Đánh dấu** (bản 5.4): khi có ý quan trọng, bấm **Đánh dấu** trong popup (có thể gõ kèm ghi chú, ví dụ "cần follow-up"), hoặc bấm **Alt+Shift+K** ở bất kỳ đâu trong Chrome mà không cần mở popup. Badge nháy **OK** màu xanh là đã đánh dấu. Đổi phím tắt tại `chrome://extensions/shortcuts`
8. Bấm **Dừng & lưu** khi xong. Đóng tab cuộc họp hoặc rời cuộc họp cũng tự dừng và lưu

**Thư viện bản ghi** (nút ở cuối tab Record):
- Xem lại video/âm thanh. **Transcript nằm bên cạnh và khớp với video**: bấm một câu là video nhảy tới đúng chỗ đó, câu đang phát được tô sáng
- Tìm trong transcript (không cần gõ dấu: "hop dong" tìm được "hợp đồng"), đổi tên bản ghi
- **🔎 Tìm trong mọi bản ghi** (bản 5.4): ô tìm kiếm phía trên danh sách. Tìm theo tên bản ghi, lời nói (CC/AI), bản dịch tiếng Việt và ghi chú của mốc. Kết quả hiện từng câu khớp kèm mốc thời gian; bấm vào là mở bản ghi và nhảy tới đúng câu đó. Bấm **Esc** để quay lại danh sách
- **🇻🇳 Dịch VI** (bản 5.4): bấm nút **Dịch VI** cạnh ô tìm kiếm để hiện bản dịch tiếng Việt dưới mỗi câu. Bản dịch được lưu lại, lần sau mở không phải dịch lại. Khi đang bật, **Tải transcript** kèm cả bản dịch. Dùng model rẻ nhất (giống Live Translate); chỉ gửi **chữ**, không gửi âm thanh
- **📌 Mốc đã đánh dấu** (dưới video): bấm để nhảy tới mốc, ✎ sửa ghi chú, × xoá. Nút **+ Đánh dấu tại đây** đánh dấu vị trí đang phát. Các mốc cũng hiện xen trong transcript
- **Tải video** (.mp4 hoặc .webm), **Tải âm thanh** (bản mono nhẹ đi kèm video), **Tải transcript** (.txt có mốc `[mm:ss]`)
- **Tạo 議事録** từ bản ghi, mang đúng ngày ghi. Tải về .txt / .docx
- **Xoá video, giữ âm thanh** (bản 5.4): bỏ phần hình để giải phóng ổ đĩa (1 giờ 1080p ≈ 1,3 GB), nhưng vẫn giữ âm thanh (mono, đủ nghe rõ lời nói), transcript, bản dịch, 議事録, mốc và Hỏi AI. Vẫn tạo/chép lại transcript AI được
- **Dọn dung lượng…** (góc trên bên phải): xoá video của mọi bản ghi cũ hơn N ngày (mặc định 30) trong một lần. Khi ổ đĩa còn dưới 5 GB, dòng dung lượng chuyển màu cảnh báo
- **Xoá** bản ghi để xoá hẳn mọi thứ

### 4.8. Transcript bằng AI & Hỏi AI về bản ghi (bản 5.1)

**⚡ Có transcript ngay khi dừng ghi (bản 5.3).** Trước khi ghi, tick **"Chép lời bằng AI ngay trong lúc ghi"** trong tab Record (lựa chọn được nhớ cho lần sau):
- Trong lúc ghi, cứ mỗi **2 phút** âm thanh được gửi cho AI chép lời. Popup hiện "AI đã chép N câu"
- Bấm **Dừng & lưu**: AI chỉ còn phải chép đoạn cuối (≤ 2 phút), nên **transcript sẵn sàng sau vài giây**. Popup ghi "AI đang chép nốt đoạn cuối…" rồi chuyển thành "N câu transcript AI"
- Mở Thư viện trong lúc đang ghi sẽ thấy transcript AI hiện dần
- Cần key **Gemini** hoặc **OpenAI**. Âm thanh được gửi đi **trong suốt cuộc họp** (chỉ khi bạn bật tuỳ chọn này)
- **Gemini quá tải (lỗi 503 "high demand")**: extension tự chuyển sang model Gemini khác (2.5 Flash → 2.5 Flash-Lite → 2.0 Flash). Nếu tất cả đều bận, đoạn đó được tự thử lại sau 20 giây rồi sau 60 giây, trong khi các đoạn khác vẫn chép bình thường
- Vẫn lỗi thì Thư viện ghi rõ đoạn nào bị thiếu (ví dụ "00:00–00:30"). Bấm **Chép lại đoạn thiếu** để gửi lại **chỉ những đoạn đó**; các câu đã chép được giữ nguyên

**👤 Nhận diện tên người nói từ màn hình họp (bản 5.5).** Tick **"Nhận diện tên người nói từ màn hình họp"** trong tab Record. Không cần bật CC, và dùng được cho cả **app Teams/Zoom cài trên máy**:
- Extension chụp **cửa sổ họp** đang ghi (4 ảnh mỗi phút, thu nhỏ còn tối đa 1280px) rồi gửi kèm âm thanh cho **Gemini**
- Gemini đọc **tên trên các ô video** và nhìn **ô đang sáng viền** (người đang nói) để gán tên thật cho từng giọng, thay cho "Speaker 1, 2…"
- Khi bật kèm **Chép lời trong lúc ghi**: ảnh được chụp ngay trong lúc ghi. Khi bấm **Tạo transcript bằng AI** trong Thư viện: ảnh lấy từ **video đã ghi** (2 ảnh mỗi phút), nên dùng được cả với bản ghi cũ
- Hiệu quả nhất khi đang ở **chế độ xem lưới / ô video** có tên. Khi đang chia sẻ màn hình toàn khung, hoặc mọi người tắt camera mà giao diện không hiện tên, AI sẽ giữ "Speaker N". Tên vẫn đổi lại được bằng chip trong Thư viện
- Ghi **Chỉ tiếng** vẫn dùng được khi chép trong lúc ghi (extension xin thêm hình 1 khung/giây chỉ để chụp, không lưu vào file). Bản ghi chỉ tiếng không có video nên không dùng được ở Thư viện
- Chỉ **Gemini** đọc được ảnh. Nếu chỉ có key OpenAI thì vẫn chép lời bình thường nhưng không đọc tên
- ⚠ Ảnh chụp có thể chứa nội dung đang hiển thị (slide, chat, tài liệu đang chia sẻ), và ảnh được gửi tới Gemini. Tốn thêm token ảnh, khoảng +25–35% chi phí so với chỉ gửi âm thanh (ước tính theo giá Gemini Flash: ảnh rẻ hơn âm thanh)

**Tạo transcript bằng AI (sau khi ghi).** Dùng cho bản ghi cũ, khi quên bật tuỳ chọn trên, hoặc khi muốn chép lại. Từ bản 5.3, các phần được xử lý **song song** (nhanh hơn khoảng 2–3 lần):
1. Mở bản ghi trong Thư viện → tab **Transcript** → bấm **✦ Tạo transcript bằng AI**
2. Xác nhận. Hộp thoại cho biết bao nhiêu phút âm thanh sẽ được gửi đi và gửi cho dịch vụ nào
3. AI nghe phần đầu để nhận diện người nói, rồi nghe các phần còn lại song song (3 phần cùng lúc) và hiện tiến độ ("xong 2/4 phần"). **Giữ trang Thư viện mở** đến khi xong. Có thể bấm **Huỷ**
4. Kết quả có mốc thời gian và người nói ("Speaker 1", "Speaker 2"… hoặc tên thật nếu nghe ra được). Lời được ghi **đúng ngôn ngữ gốc** (tiếng Nhật vẫn là tiếng Nhật)
5. Bấm vào các chip tên phía trên transcript để **đổi tên người nói** (vd. "Speaker 1" → "Tanaka"). Tên mới được áp dụng cho mọi câu

- Bản ghi có **cả CC và AI**: dùng nút **CC / AI** để chọn nguồn. Nguồn đang chọn được dùng để hiển thị, tải transcript, tạo 議事録 và Hỏi AI
- Dùng key **Gemini** (khuyên dùng) hoặc **OpenAI**. **DeepSeek không nhận âm thanh**
- Chi phí với Gemini khoảng **1.920 token âm thanh mỗi phút** (≈ 115.000 token mỗi giờ)
- Nếu bị lỗi giữa chừng, phần đã xong vẫn được lưu kèm cảnh báo ⚠. Bấm **Tạo lại bằng AI** để chạy lại

**Hỏi AI** (tab thứ ba ở cột bên phải):
- Gõ câu hỏi bất kỳ ("Ai phụ trách kiểm thử?", "Khách hàng lo ngại điều gì?"), hoặc bấm các gợi ý **Tóm tắt / Quyết định đã chốt / Việc cần làm / Vấn đề còn bỏ ngỏ**
- AI chỉ trả lời dựa trên transcript, kèm các mốc **[mm:ss]**. **Bấm vào mốc để nghe lại đúng đoạn đó**
- Hội thoại được lưu cùng bản ghi. Bấm "Xoá hội thoại" để xoá

> 🔒 **Âm thanh chỉ rời khỏi máy khi bạn bấm "Tạo transcript bằng AI" và xác nhận, hoặc khi bạn bật "Chép lời bằng AI ngay trong lúc ghi".** **Ảnh chụp màn hình** chỉ được gửi khi bạn bật thêm "Nhận diện tên người nói từ màn hình họp". Hỏi AI và 議事録 chỉ gửi **chữ** (transcript), không gửi âm thanh hay video. Nếu tắt Failover, âm thanh chỉ được gửi tới một dịch vụ AI duy nhất.

| Câu hỏi | Trả lời |
|---|---|
| Bản ghi lưu ở đâu? | Chỉ trên máy này (IndexedDB của Chrome). Không tải lên đâu cả. Xoá extension thì bản ghi cũng mất, vì vậy hãy **tải về** những bản ghi cần giữ |
| Dung lượng? | Mức tối đa mỗi giờ: 720p ≈ 0.7 GB, 1080p ≈ 1.4 GB, 2K ≈ 2.3 GB. Màn hình họp phần lớn đứng yên nên file thật thường nhỏ hơn. Chỉ tiếng ≈ 45 MB/giờ |
| Vì sao bản ghi không có transcript? | Transcript tự động lấy từ phụ đề (CC), nên hãy **bật CC** trong lúc ghi. Nếu quên bật, dùng **Tạo transcript bằng AI** (mục 4.8) |
| Ghi được trang khác ngoài Meet/Teams/Zoom không? | Được. Ghi được mọi tab web (YouTube, bài giảng…), nhưng chỉ Meet/Teams/Zoom mới có transcript |
| Ghi được cửa sổ khác / cả màn hình / app Teams cài trên máy không? | Được (bản 5.2). Chọn nguồn **Màn hình / cửa sổ**. Xem mục âm thanh ngay dưới |
| Ghi app Teams/Zoom cài trên máy mà có tiếng? | Chọn **Toàn màn hình** và bật **Chia sẻ âm thanh hệ thống** trong hộp chọn của Chrome (có trên Windows). Bật thêm **micro** để có giọng bạn. Lưu ý: âm thanh hệ thống gồm mọi âm thanh của máy, kể cả tiếng thông báo |
| Chọn **Cửa sổ** thì sao? | Chrome không ghi được tiếng hệ thống khi chọn một cửa sổ, nên bản ghi chỉ có giọng bạn qua micro. Popup sẽ cảnh báo. Tắt cả micro thì bản ghi không có âm thanh và không tạo được transcript |
| macOS? | Ghi hình màn hình/cửa sổ được. Âm thanh hệ thống tuỳ phiên bản macOS/Chrome, có thể không có; khi đó dùng micro |
| Dừng ghi màn hình thế nào? | Bấm **Dừng & lưu** trong popup, hoặc nút **Dừng chia sẻ** trên thanh của Chrome. Cả hai đều lưu bản ghi |
| Bản ghi màn hình có transcript không? | Nếu lúc bấm ghi bạn đang ở tab **Meet/Teams/Zoom bản web** có bật CC, transcript CC được gắn vào bản ghi. Còn lại (vd. app Teams cài trên máy) thì dùng **Tạo transcript bằng AI** |
| Chrome bị tắt đột ngột khi đang ghi? | Các đoạn đã ghi (cứ 5 giây một đoạn) vẫn còn. Bản ghi hiện trong thư viện với nhãn **Bị gián đoạn** và vẫn xem/tải được |
| File .webm mở bằng gì? | Chrome, VLC, hoặc kéo thẳng vào trình duyệt. Từ bản 5.4, video mặc định là **.mp4**, mở được ở mọi nơi |

---

## Các tính năng đặc biệt

### Standby Mode (Tự động ghi ngầm)

- Khi bạn mở trang Google Meet, Teams hoặc Zoom, extension tự động bắt đầu theo dõi phụ đề ngầm
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
- Kiểm tra đã bật Caption/Phụ đề trên Meet, Teams hoặc Zoom chưa
- Thử bấm nút "Reload" trong overlay
- **Zoom:** từ bản 4.9 extension tự bám theo hộp phụ đề (Zoom ẩn hộp khi không ai nói và dựng lại khi có người nói tiếp). Nếu vẫn không thấy gì, mở Console của tab Zoom (F12), chạy `localStorage.setItem('mt_debug','1')` rồi tải lại trang — log `[MeetingAI] zoom: ...` cho biết extension đang đọc phần tử nào, gửi log đó kèm ảnh chụp để được hỗ trợ

**Q: Bấm "議事録作成" bị lỗi?**
- Kiểm tra API key đã lưu đúng chưa (vào Settings → Kiểm tra API Key)
- Nếu hiện "quota hết" — đợi 1 phút rồi thử lại, hoặc tạo API key mới

**Q: Có an toàn không? Dữ liệu đi đâu?**
- Transcript và bản ghi hình chỉ lưu trên máy của bạn (Chrome storage / IndexedDB)
- Nội dung chỉ được gửi lên API của AI (Gemini / OpenAI / DeepSeek) khi bạn **tạo 議事録**, **bật Live Translate** hoặc **Hỏi AI**. File video không bao giờ được gửi đi. Âm thanh chỉ được gửi khi bạn bấm **Tạo transcript bằng AI** và xác nhận
- Nếu bật **Failover**, khi provider chính lỗi thì nội dung sẽ được gửi sang provider dự phòng
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
8. (Tuỳ chọn) Tab Record → Bắt đầu ghi → Dừng & lưu → xem lại trong Thư viện bản ghi
```
