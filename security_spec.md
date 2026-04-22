# Security Spec - Gia sư AI KHTN

## Data Invariants
1. Học sinh chỉ có thể đọc và sửa dữ liệu của chính mình (`/students/{uid}`).
2. Dữ liệu tài liệu (`/documents/`) chỉ có thể được tải lên bởi giáo viên (Admin), học sinh chỉ được quyền đọc.
3. Chat message phải có `studentId` khớp với người gửi.
4. XP không bao giờ giảm, chỉ có thể tăng hoặc giữ nguyên.

## "Dirty Dozen" Payloads (Rejected)
1. Thử cập nhật XP học sinh khác.
2. Thử xóa tài liệu của giáo viên.
3. Thử gửi message với `studentId` giả.
4. Thử đặt XP là 1 tỷ ngay khi tạo tài khoản.
5. Thử gửi `content` chat cực lớn (>1MB).
6. Thử thay đổi `role` của chính mình thành giáo viên.
7. Thử truy cập PII (email) của học sinh khác.
8. Thử bỏ qua bước logic trạng thái: Hoàn thành Quiz mà không làm câu nào.
9. Thử tiêm mã độc vào document ID.
10. Thử cập nhật `createdAt` của một message cũ.
11. Thử thay đổi đáp án của một Quiz đã tạo.
12. Thử đọc danh sách toàn bộ học sinh mà không phải Admin.

## Security Controls
- **Identity Integrity**: Checks `request.auth.uid`.
- **Validation Blueprints**: `isValidStudent`, `isValidMessage`.
- **Master Gate**: Access to sub-resources tied to parent ID.
- **Immortal Fields**: `createdAt`, `originalOwnerId`.
