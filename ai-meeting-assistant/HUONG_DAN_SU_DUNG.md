# AI Meeting Assistant – Hướng dẫn sử dụng (v7.1)

## Tool này là gì?

AI Meeting Assistant là extension (tiện ích mở rộng) cài trên Google Chrome, giúp bạn:

- **Chép lời** cuộc họp Google Meet, Microsoft Teams hoặc Zoom (bản web) theo thời gian thực, **tách theo từng người nói**.
- **Ghi hình / ghi âm** cuộc họp: ghi tab cuộc họp hoặc màn hình, và đổi nguồn giữa chừng mà vẫn ra **một video**.
- **Xem lại trong Thư viện bản ghi**: transcript khớp với video, Hỏi AI về cuộc họp, dịch tiếng Việt, tải video / âm thanh / script.
- **Tạo biên bản họp (議事録)** bằng AI chỉ với một nút bấm, trình bày theo chuẩn công ty Nhật.

---

## Bước 1: Cài đặt extension lên Chrome

1. Mở **Google Chrome** và vào `chrome://extensions`.
2. Bật **Developer mode** (công tắc ở góc trên bên phải).
3. Bấm **Load unpacked** rồi chọn thư mục `ai-meeting-assistant` (thư mục chứa `manifest.json`).
4. Icon extension sẽ xuất hiện trên thanh công cụ.

> 💡 Bấm icon mảnh ghép trên thanh Chrome rồi ghim "AI Meeting Assistant" để dễ mở.

**Cập nhật lên bản mới:** chép đè thư mục rồi bấm **↻ Reload** ở thẻ extension trong `chrome://extensions`. **Không cần F5 tab họp**, vì F5 sẽ làm bạn rời cuộc họp. Extension tự nạp lại vào các tab Meet / Teams / Zoom đang mở. Nếu mở popup mà vẫn báo "Mất kết nối", extension sẽ tự nạp lại vào tab đó rồi thử lại.

---

## Bước 2: API key (chỉ cần cho tính năng AI)

**Bắt transcript và ghi hình không cần API key.** Key chỉ cần cho: **議事録**, **Summary**, **Translate**, **Hỏi AI**, **Tạo transcript bằng AI**.

| Nhà cung cấp | Lấy key ở đâu | Ghi chú |
|---|---|---|
| **Google Gemini** (khuyên dùng) | https://aistudio.google.com/apikey (key bắt đầu bằng `AIza...`) | Có gói miễn phí. Nghe được âm thanh và đọc được ảnh |
| **OpenAI** | platform.openai.com | Nghe được âm thanh |
| **DeepSeek** | platform.deepseek.com | Rẻ, nhưng **không nhận âm thanh** (không dùng cho chép lời bằng AI) |

Cài key:
1. Bấm icon extension → tab **Settings**.
2. Chọn **Provider**, dán key, bấm **Save**.
3. Bấm **Kiểm tra API Key** để xác nhận. Kết quả hiện cả model đang dùng.
4. (Tuỳ chọn) Bật **Tự động chuyển API khi lỗi (Failover)**: khi nhà cung cấp chính lỗi, extension tự chuyển sang nhà cung cấp khác đã có key.

---

## Bước 3: Sử dụng trong cuộc họp

### 3.1. Vào phòng họp và bật phụ đề (CC)

Mở **Google Meet** (meet.google.com), **Microsoft Teams** (teams.microsoft.com) hoặc **Zoom** (app.zoom.us, tham gia qua trình duyệt), rồi bật phụ đề:

- **Google Meet:** bấm nút **CC** ở thanh điều khiển.
- **Microsoft Teams:** bấm **… (More)** → **Turn on live captions**.
- **Zoom (web):** bấm **Live Transcript / CC** → **Enable**.

> ⚠️ Extension đọc phụ đề của nền tảng để chép lời. Nếu không bật CC, extension dùng mic (kém chính xác hơn và không nghe được người khác).

**Icon CC trong popup** (ở hàng Transcript / Translate):

| Icon | Nghĩa |
|------|-------|
| **CC** xanh | Đang đọc trực tiếp từ phụ đề |
| **CC** gạch chéo | Chưa bật CC (hoặc đã tắt giữa buổi), extension đang dùng mic |

Bật hoặc tắt CC giữa buổi thì icon tự đổi sau vài giây.

> 💡 **Standby Mode:** ngay khi mở trang họp, extension đã ngầm chép phụ đề dù bạn chưa bấm gì. Lúc bấm **Bắt đầu**, phần đã nói trước đó hiện ra ngay.

### 3.2. Bắt đầu

1. Bấm icon extension → tab **Control** → **Bắt đầu**.
2. Bảng chọn cách ghi hình hiện ra, **luôn chọn sẵn Tab + 1080p**:
   - **Nguồn:** **Tab** (ghi tab cuộc họp, có sẵn tiếng), **Màn hình** (Chrome hỏi bạn chọn màn hình / cửa sổ / tab), hoặc **Không ghi** (chỉ lấy transcript).
   - **Chất lượng:** 720p / 1080p / 2K / Chỉ tiếng.
   - **Micro:** ghi kèm giọng của bạn.
3. Bấm **Bắt đầu** lần nữa. Muốn nhanh thì cứ bấm **Bắt đầu** hai lần là ghi Tab 1080p.

> Lần đầu ghi kèm micro, extension mở một trang để bạn **cấp quyền micro một lần**. Nếu chưa cấp, extension vẫn ghi nhưng không có micro và báo trong popup.

### 3.3. Đọc header của popup

Góc trên bên phải popup chỉ có **2 khối**:

| Khối | Nghĩa |
|---|---|
| `● 12:34` **xanh lá** (chấm trắng nhấp nháy) | Đang chép transcript |
| `II 12:34` **vàng** | Transcript đang tạm dừng |
| `● Tab 12:34` / `● Màn hình 12:34` **đỏ** | Đang ghi hình. Bấm vào để sang tab **Record** |
| `Chưa hoạt động` | Chưa bấm Bắt đầu |

Khi đang ghi hình, icon extension có thêm **chấm đỏ nhỏ**.

### 3.4. Các nút trong tab Control

**Control là bảng chính**: thao tác ở đây kéo theo cả bản ghi hình.

| Nút | Chức năng |
|-----|-----------|
| **Tạm dừng** | Dừng chép transcript **và** tạm dừng bản ghi hình |
| **Tiếp tục** | Chép tiếp và ghi tiếp, giữ nguyên nguồn ghi đang dùng |
| **Kết thúc** | Dừng hẳn. Bản ghi hình được **lưu vào Thư viện**, transcript ở Control được xoá để sẵn sàng cho phiên mới. Script vẫn tải lại được trong Thư viện |
| **Meeting Minutes** | AI tạo biên bản họp 議事録 (xem mục 3.6) |
| **Copy** | Copy transcript |
| **Tải** | Tải **cả transcript lẫn video / âm thanh** của phiên đang diễn ra |
| **Xoá** | Xoá transcript đang hiển thị |
| **Reload** | Khởi động lại việc nhận dạng |
| **Ghi tab này** | Hiện khi đang họp mà chưa ghi hình. Bấm để ghi nhanh tab này (1080p) |

> Tạm dừng / Dừng ở **tab Record** chỉ tác động lên bản ghi hình, không ảnh hưởng transcript ở Control.

Phím tắt **Alt+Shift+M** = Tạm dừng / Tiếp tục (giống nút ở Control).

### 3.5. Xem bản dịch tiếng Việt (tab Translate)

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


### 3.6. Tạo biên bản họp (議事録)

1. Để cuộc họp diễn ra, transcript sẽ tự tích lũy.
2. Bấm **Meeting Minutes**: AI tự tạo biên bản (nếu đã có thì hiện lại bản đã tạo). AI cần khoảng 10–30 giây (DeepSeek có thể tới 1–1,5 phút).
3. Bấm **Copy**, **.txt** hoặc **.docx** để lưu lại.

Bạn cũng tạo được 議事録 sau cuộc họp, từ bản ghi trong **Thư viện bản ghi**. Biên bản khi đó mang đúng ngày ghi.

### 3.7. Ghi hình / ghi âm (tab Record)

> ⚠️ **Người tham gia KHÔNG được thông báo** khi bạn ghi bằng extension (khác với nút Record có sẵn của Meet / Teams / Zoom). Hãy xin phép mọi người trước khi ghi.

Thường thì bạn bắt đầu ghi từ nút **Bắt đầu** ở Control (mục 3.2). Tab **Record** dùng để xem chi tiết, đổi nguồn ghi và chỉnh các tuỳ chọn:

- **Nguồn ghi:**
  - **Tab này:** ghi tab Chrome đang mở, có sẵn tiếng của tab.
  - **Màn hình / cửa sổ:** Chrome hỏi bạn chọn **Toàn màn hình**, **Cửa sổ** hoặc **Tab**. Dùng khi họp bằng **app Teams / Zoom cài trên máy**, hoặc để ghi slide, phần mềm khác.
- **Hình + tiếng** (720p / 1080p / 2K) hoặc **Chỉ tiếng** (file nhỏ).
- **Định dạng:** **MP4 (H.264)** là mặc định, nhẹ máy và mở được ở mọi nơi. **WebM (VP9)** nét hơn nhưng tốn CPU hơn.
- **Ghi kèm micro của tôi** và chọn micro cụ thể (tai nghe, micro USB…). Nếu micro đã chọn bị rút ra, extension dùng micro mặc định và báo trong popup.
- **🎙 Micro đi theo nút mic của cuộc họp** (Meet / Teams / Zoom bản web):
  - Bạn **mute** trong cuộc họp thì bản ghi **không thu giọng bạn**. Bật mic lại thì thu tiếp, vẫn trong cùng một video.
  - Dòng thông tin trong tab Record hiện *"micro: đang tắt theo cuộc họp"*.
  - Họp bằng app cài trên máy thì extension không đọc được nút mic, nên micro luôn thu.
- **📌 Đánh dấu:** bấm **Đánh dấu** (có thể gõ kèm ghi chú) hoặc phím tắt **Alt+Shift+K** ở bất kỳ đâu trong Chrome. Badge nháy **OK** màu xanh là đã đánh dấu. Đổi phím tắt tại `chrome://extensions/shortcuts`.
- **Tạm dừng / Tiếp tục / Dừng & lưu** chỉ tác động lên bản ghi hình. Đóng tab họp hoặc rời cuộc họp cũng tự dừng và lưu. **Đóng popup thì vẫn ghi tiếp.**

#### Đổi nguồn giữa chừng: vẫn một video

Đang ghi thì vẫn đổi được nguồn **Tab ⇄ Màn hình**, kết quả vẫn là **một file video liền mạch**.

**Ví dụ: đang họp Teams, đến lượt bạn thuyết trình bằng cách share một tab khác:**

1. Bắt đầu như bình thường: ghi **Tab** (tab Teams).
2. Khi share, mở popup → tab **Record** → **Chuyển sang ghi màn hình / tab đang share**, rồi chọn tab hoặc màn hình bạn đang share.
3. Bản ghi lấy **hình từ phần đang share**, còn **tiếng vẫn lấy từ tab Teams**, nên vẫn nghe được mọi người.
4. Share xong: bấm **Quay lại ghi tab cuộc họp**, hoặc bấm **Dừng chia sẻ** trên thanh của Chrome. Extension tự quay lại ghi tab Teams.

### 3.8. Thư viện bản ghi

Mở Thư viện bằng nút **Thư viện bản ghi** ở cuối tab Record, hoặc **Settings → Lịch sử cuộc họp → Mở Thư viện bản ghi**.

**Thời gian lưu:**
- Thư viện giữ tối đa **15 bản ghi** và **15 script** gần nhất. **Mỗi bản tối đa 7 ngày**, quá hạn thì tự xoá.
- Mỗi bản ghi có nhãn hạn xoá: **"Xoá sau: 3 ngày"**, hoặc **"Xoá khi có bản mới"** nếu thư viện đã đủ 15 bản và đây là bản cũ nhất. Mở bản ghi sẽ thấy ngày giờ tự xoá chính xác.
- Muốn giữ lâu hơn thì **tải về**.

**Trong mỗi bản ghi:**
- Xem lại video / âm thanh. **Transcript nằm bên cạnh và khớp với video**: bấm một câu là video nhảy tới đúng chỗ đó, câu đang phát được tô sáng.
- Tìm trong transcript (không cần gõ dấu: "hop dong" tìm được "hợp đồng"). Đổi được tên bản ghi.
- **🇻🇳 Dịch VI:** hiện bản dịch tiếng Việt dưới mỗi câu. Bản dịch được lưu lại. Khi đang bật, **Tải transcript** kèm cả bản dịch.
- **📌 Mốc đã đánh dấu** (dưới video): bấm để nhảy tới mốc, ✎ để sửa ghi chú, × để xoá. **+ Đánh dấu tại đây** đánh dấu vị trí đang phát.
- **Tải video** (.mp4 / .webm), **Tải âm thanh** (bản mono nhẹ), **Tải transcript** (.txt có mốc `[mm:ss]`).
- **Tạo 議事録** từ bản ghi, tải về .txt / .docx.
- **Xoá video, giữ âm thanh:** bỏ phần hình để giải phóng ổ đĩa (1 giờ 1080p ≈ 1,3 GB) nhưng vẫn giữ âm thanh, transcript, bản dịch, 議事録, mốc và Hỏi AI.
- **Xoá** để xoá hẳn bản ghi.

**Chung cho cả Thư viện:**
- **🔎 Tìm trong mọi bản ghi** (ô phía trên danh sách): tìm theo tên, lời nói, bản dịch và ghi chú của mốc. Bấm kết quả là nhảy tới đúng câu. **Esc** để quay lại danh sách.
- **Script cuộc họp** (cột trái, dưới danh sách bản ghi):
  - Gồm transcript và 議事録 của các phiên họp gần nhất, **kể cả phiên không ghi hình**.
  - Mỗi phiên có nút **Script**, **議事録** và **Xoá**.
- **Dọn dung lượng…** (góc trên bên phải): xoá phần video của mọi bản ghi cũ hơn N ngày (mặc định 2) trong một lần. Khi ổ đĩa còn dưới 5 GB, dòng dung lượng chuyển màu cảnh báo.

### 3.9. Transcript bằng AI & Hỏi AI về bản ghi

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
| Bản ghi lưu ở đâu? | Chỉ trên máy này (IndexedDB của Chrome), không tải lên đâu cả. Xoá extension thì bản ghi cũng mất, nên hãy **tải về** những bản cần giữ |
| Dung lượng? | Mức tối đa mỗi giờ: 720p ≈ 0,7 GB, 1080p ≈ 1,4 GB, 2K ≈ 2,3 GB. Màn hình họp phần lớn đứng yên nên file thật thường nhỏ hơn. Chỉ tiếng ≈ 45 MB/giờ |
| Vì sao bản ghi không có transcript? | Transcript tự động lấy từ phụ đề (CC), nên hãy **bật CC** trong lúc ghi. Nếu quên bật, dùng **Tạo transcript bằng AI** (mục 3.9) |
| Ghi được trang khác ngoài Meet / Teams / Zoom không? | Được. Ghi được mọi tab web, nhưng chỉ Meet / Teams / Zoom mới có transcript CC |
| Ghi app Teams / Zoom cài trên máy mà có tiếng? | Chọn **Màn hình** → **Toàn màn hình** và bật **Chia sẻ âm thanh hệ thống** trong hộp chọn của Chrome (có trên Windows). Bật thêm **micro** để có giọng bạn. Âm thanh hệ thống gồm mọi âm thanh của máy, kể cả tiếng thông báo |
| Chọn **Cửa sổ** thì sao? | Chrome không ghi được tiếng hệ thống khi chọn một cửa sổ, nên bản ghi chỉ có giọng bạn qua micro. Popup sẽ cảnh báo |
| macOS? | Ghi màn hình / cửa sổ được. Âm thanh hệ thống tuỳ phiên bản macOS / Chrome, có thể không có; khi đó dùng micro |
| Dừng ghi màn hình thế nào? | Bấm **Kết thúc** ở Control, **Dừng & lưu** ở tab Record, hoặc **Dừng chia sẻ** trên thanh của Chrome. Nếu đang ghi phần share của bản ghi Tab, Dừng chia sẻ sẽ quay lại ghi tab họp, không dừng bản ghi |
| Bản ghi màn hình có transcript không? | Có, nếu lúc bấm ghi bạn đang ở tab **Meet / Teams / Zoom bản web** có bật CC. Còn lại (vd. app cài trên máy) thì dùng **Tạo transcript bằng AI** |
| Chrome bị tắt đột ngột khi đang ghi? | Các đoạn đã ghi (cứ 5 giây một đoạn) vẫn còn. Bản ghi hiện trong Thư viện với nhãn **Bị gián đoạn** và vẫn xem / tải được |

---

## Các tính năng đặc biệt

### Standby Mode (tự động chép ngầm)

- Khi bạn mở trang Google Meet, Teams hoặc Zoom, extension tự động theo dõi phụ đề ngầm.
- Không cần bấm **Bắt đầu**: lời nói đã được chép từ lúc bắt đầu họp. Bấm Bắt đầu thì phần trước đó hiện lên ngay.
- Chỉ chạy trên 5 domain: `meet.google.com`, `teams.microsoft.com`, `teams.live.com`, `app.zoom.us`, `zoom.us`.

### Tự động lưu

- Transcript được tự động lưu mỗi 15 giây, nên tắt popup, tắt trình duyệt hay reload extension đều không mất.
- Mỗi phiên họp được lưu vào **Script cuộc họp** trong Thư viện (15 phiên gần nhất, tối đa 7 ngày), kể cả khi bạn đóng tab họp mà không bấm Kết thúc.

### Tự động chọn model AI mới nhất

- Extension hỏi danh sách model của nhà cung cấp rồi tự chọn: biên bản / Hỏi AI dùng bản Flash mới nhất, Translate dùng bản rẻ nhất (Flash-Lite / mini).
- Nhà cung cấp ra model mới là tự dùng, không cần cập nhật extension.

---

## Câu hỏi thường gặp

**Q: Mở popup báo "Mất kết nối với trang họp"?**
- Thường xảy ra ngay sau khi reload hoặc cập nhật extension. Từ bản 7.0, extension **tự nạp lại vào tab họp**, nên chỉ cần đóng rồi mở lại popup.
- Chỉ F5 khi thông báo vẫn còn (lưu ý: F5 sẽ làm bạn rời cuộc họp).

**Q: Tại sao transcript không hiện gì?**
- Kiểm tra đã bật phụ đề (CC) trên Meet, Teams hoặc Zoom chưa.
- Thử bấm nút **Reload** trong tab Control.
- **Zoom:** nếu vẫn không thấy gì, mở Console của tab Zoom (F12), chạy `localStorage.setItem('mt_debug','1')` rồi tải lại trang. Log `[MeetingAI] zoom: ...` cho biết extension đang đọc phần tử nào; gửi log đó kèm ảnh chụp để được hỗ trợ.

**Q: Mute mic trong cuộc họp mà video vẫn có giọng mình?**
- Từ bản 6.9, micro của bản ghi tự tắt theo nút mic của Meet / Teams / Zoom bản web. Kiểm tra tab Record có hiện *"micro: đang tắt theo cuộc họp"* khi bạn mute không.
- Nếu không hiện, có thể nền tảng vừa đổi giao diện. Khi đó extension giữ micro **bật** để không làm mất giọng bạn; hãy báo lại để được cập nhật.

**Q: Bấm 議事録 bị lỗi?**
- Kiểm tra API key đã lưu đúng chưa (Settings → **Kiểm tra API Key**).
- Báo "quota hết": đợi 1 phút rồi thử lại, hoặc dùng key khác / bật **Failover**.
- DeepSeek báo "dùng hết token cho phần suy nghĩ": thử lại, hoặc đổi sang Gemini / OpenAI.

**Q: Có an toàn không? Dữ liệu đi đâu?**
- Transcript, bản ghi hình và 議事録 chỉ lưu trên máy của bạn (Chrome storage / IndexedDB). Không có server trung gian.
- Nội dung chỉ được gửi lên AI (Gemini / OpenAI / DeepSeek) khi bạn **chủ động bấm** 議事録, Summary, Hỏi AI, Dịch VI, **bật** Translate, hoặc **bật** "Chép lời bằng AI ngay trong lúc ghi".
- File video không bao giờ được gửi đi. Âm thanh chỉ được gửi khi bạn bấm **Tạo transcript bằng AI** và xác nhận, hoặc bật chép lời trong lúc ghi.
- Nếu bật **Failover**, khi nhà cung cấp chính lỗi thì nội dung được gửi sang nhà cung cấp dự phòng.

**Q: Dùng được trên máy nào?**
- Mọi máy có Google Chrome (Windows, Mac, Linux). Không hỗ trợ Firefox / Safari.

---

## Tổng kết các bước

```
1. Cài extension vào Chrome (Load unpacked)
2. (Tuỳ chọn) Lưu API key trong Settings — chỉ cần cho 議事録 / Dịch / Hỏi AI
3. Vào họp, bật phụ đề (CC)
4. Control → Bắt đầu → (mặc định Tab + 1080p + micro) → Bắt đầu
5. Thuyết trình bằng share? Record → Chuyển sang ghi màn hình / tab đang share
6. Meeting Minutes → AI tạo 議事録 → Copy / .txt / .docx
7. Kết thúc → bản ghi tự lưu vào Thư viện
8. Xem lại / tải video, âm thanh, script: Settings → Mở Thư viện bản ghi
```
