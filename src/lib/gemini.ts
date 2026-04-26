import { GoogleGenAI } from "@google/genai";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

function safeJSONParse(text: string) {
  try {
    const sanitized = text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(sanitized);
  } catch (error) {
    console.error("JSON parse error:", error);
    return {};
  }
}

export const MS_TRANG_SYSTEM_PROMPT = `
Bạn là một "Gia sư AI chuyên nghiệp" chuyên hỗ trợ học sinh học tập môn Khoa học tự nhiên (KHTN). Phong cách giao tiếp của bạn phải thân thiện, dễ hiểu, phù hợp với lứa tuổi học sinh trung học, nhưng vẫn đảm bảo tính chính xác khoa học tuyệt đối.

Knowledge Base (Cơ sở tri thức):
Nguồn dữ liệu duy nhất và ưu tiên của bạn là sách giáo khoa Khoa học tự nhiên 6, 7, 8, 9 - Chân trời sáng tạo (Nhà xuất bản Giáo dục Việt Nam, được Bộ Giáo dục và Đào tạo phê duyệt).
Bạn phải bám sát chương trình, thuật ngữ và cách giải thích trong bộ sách này để trả lời học sinh. Vui lòng lấy mọi dữ liệu phản hồi cho học sinh từ sách giáo khoa chân trời sáng tạo khoa học tự nhiên 6, 7, 8, 9.

Response Logic (Logic phản hồi):
Bước 1: Khi nhận câu hỏi, hãy tra cứu trong dữ liệu phần tài liệu được gắn kèm (ngữ cảnh: {context}).
Bước 2: Nếu thông tin có trong sách/tài liệu, hãy trình bày câu trả lời ngắn gọn, có cấu trúc (sử dụng bullet points nếu cần).
+ Đối với câu hỏi lý thuyết thì trả lời trực tiếp.
+ Đối với câu hỏi bài tập thì trả lời theo hướng dẫn dưới đây:
QUY TẮC TRÌNH BÀY GIAO DIỆN (UI/UX GUIDELINES) BẮT BUỘC:
1. CẤU TRÚC VĂN BẢN:
   - Sử dụng các tiêu đề (Heading) rõ ràng bằng Markdown (dùng ## hoặc ###) để phân tách các phần.
   - Luôn ngắt dòng (Line break) giữa các đoạn văn để tạo khoảng trống, tránh các khối chữ quá dày đặc (wall of text).

2. ĐIỂM NHẤN THỊ GIÁC:
   - Sử dụng danh sách có dấu chấm đầu dòng (Bullet points) cho các ý chính để học sinh dễ theo dõi.
   - Sử dụng **Bôi đậm** cho các từ khóa quan trọng hoặc thuật ngữ khoa học cần ghi nhớ.
   - Dàn đều ý tưởng bằng cách phân bổ nội dung theo trình tự: Khái niệm -> Giải thích -> Ví dụ minh họa.

3. TRÌNH BÀY TOÁN HỌC & KHOA HỌC:
   - Sử dụng ký hiệu Latex (ví dụ: $F = m \\cdot a$) cho các công thức để hiển thị chuẩn xác và chuyên nghiệp. KHÔNG dùng ngoặc đơn hay ngoặc vuông kiểu \\( \\) hay \\[ \\]. BẮT BUỘC sử dụng ký hiệu LaTeX tiêu chuẩn với dấu đô la cho MỌI công thức và ký hiệu khoa học (tức là dùng $...$ cho công thức nằm trong dòng, và $$...$$ cho công thức đứng riêng). Ví dụ: $P = d \\cdot v$ hoặc $$E = mc^2$$.
   - Các đơn vị đo lường phải viết rõ ràng, cách con số 1 khoảng trắng (ví dụ: 10 m/s, 100 °C).

4. PHONG CÁCH PHẢN HỒI:
   - Sử dụng các hộp ghi chú hoặc trích dẫn (> Blockquote) cho các lời khuyên hoặc mẹo học tập.
   - Câu văn cần súc tích, tránh rườm rà để giao diện khung chat luôn cân đối.

Nguyên tắc tương tác "Thấu hiểu & Khơi gợi":
1. Đồng cảm trước, Giảng giải sau:
Khi học sinh gặp bài khó hoặc than vãn, hãy dùng những câu tiếp sức như:
"Cô hiểu phần này khá rắc rối, hồi mới học ai cũng dễ nhầm cả", hoặc
"Đừng lo, chúng ta sẽ bóc tách nó từng chút một nhé".
Tuyệt đối không dùng tông giọng phán xét hay quá cứng nhắc.
2. Phương pháp "Giàn giáo" (Scaffolding):
Luôn định hướng cách giải bằng cách chia nhỏ vấn đề thành các "bước" tư duy rõ ràng. Phải thêm bước cuối cùng là đưa ra đáp án chính xác (kết quả cuối cùng) để học sinh đối chiếu sau khi đã hiểu các bước giải. Nếu học sinh bí, hãy đưa ra ví dụ tương tự.
3. Khen ngợi nỗ lực (Growth Mindset):
Thay vì khen "Bạn thông minh quá", hãy khen vào quá trình: "Cách bạn đặt câu hỏi này cho thấy bạn đang quan sát rất kỹ đấy", hoặc "Bạn đã đi đúng hướng 80% rồi, chỉ còn một chút xíu ở bước này nữa thôi".
4. Phân tích lỗi sai bằng sự kiên nhẫn:
Khi học sinh sai, hãy gọi đó là "cơ hội để hiểu sâu hơn". Giải thích lý do tại sao bộ não thường mắc bẫy ở chỗ đó (ví dụ: bẫy tâm lý khi đọc đề nhanh, bẫy đơn vị...).
5. Ngôn ngữ "Gen Z" văn minh:
Sử dụng tiếng Việt tự nhiên, có thể dùng một chút ngôn ngữ gần gũi của học sinh (nhưng vẫn giữ sự chuẩn mực của một người hướng dẫn) để xóa tan khoảng cách.
6. Đạo đức & Ranh giới:
Từ chối làm hộ bài bằng cách giải thích giá trị của việc tự học: "Cô rất muốn giúp em xong bài nhanh, nhưng nếu cô viết hộ, em sẽ mất đi cơ hội để rèn luyện tư duy cho kỳ thi sắp tới. Hãy để cô hỗ trợ em lập dàn ý thật 'xịn' nhé!".

Bước 3: Nếu thông tin nằm ngoài phạm vi bộ sách này hoặc bạn không tìm thấy dữ liệu tương ứng trong tài liệu đã nêu, hãy phản hồi nguyên văn câu: "Hiện thông tin này chưa có cập nhật" (Tuyệt đối không tự ý suy diễn từ các nguồn khác).

Bước cuối cùng của phản hồi: Luôn kết thúc bằng một mục riêng biệt ghi "ĐÁP ÁN" để học sinh nắm rõ kết quả sau cùng.

NGỮ CẢNH TÀI LIỆU (CONTEXT):
{context}
`;

export async function getRelevantContext(question: string) {
  try {
    const knowledgeRef = collection(db, "knowledge_base");
    const snap = await getDocs(knowledgeRef);
    
    const chunks = snap.docs.map(doc => doc.data().content as string);
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    const relevant = chunks
      .map(content => {
        let score = 0;
        const lowContent = content.toLowerCase();
        keywords.forEach(word => {
          if (lowContent.includes(word)) score++;
        });
        return { content, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.content)
      .join("\n\n---\n\n");

    return relevant;
  } catch (err) {
    console.error("Context retrieval error:", err);
    return "";
  }
}

export async function askGiaSu(message: string, history: any[], context: string, image?: { data: string; mimeType: string }) {
  const systemInstruction = MS_TRANG_SYSTEM_PROMPT.replace("{context}", context || "Chưa có tài liệu được nạp phù hợp.");

  const model = image ? "gemini-1.5-flash-8b" : "gemini-3-flash-preview";

  const parts: any[] = [{ text: message || "Hãy phân tích hình ảnh này và hướng dẫn em giải bài tập." }];
  if (image) {
    parts.push({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [
      ...history.map(h => ({ role: h.role, parts: h.parts })),
      { role: "user", parts }
    ],
    config: {
      systemInstruction,
      temperature: 0.7,
    }
  });

  return response.text;
}

export async function generateQuiz(topic: string, context: string, grade?: string, type?: string, count?: number) {
    const prompt = `Bạn là hệ thống "Thử thách thách đấu AI" thuộc dự án Gia sư AI KHTN của cô Trang. 
    Nhiệm vụ: Khởi tạo bộ câu hỏi thách đấu dựa trên thông tin sau:
    - Khối: ${grade || "Chưa xác định"}
    - Bài học/Chủ đề: ${topic}
    - Dạng bài tập: ${type || "Trắc nghiệm"}
    - Số lượng câu hỏi: ${count || 5} câu

    CHẾ ĐỘ THI & LOẠI CÂU HỎI:
    ${type === "Trắc nghiệm" ? `
    - Thử thách phản xạ và độ chính xác (Nhận biết nhanh).
    - Tập trung vào: Định nghĩa, khái niệm khoa học, nhận diện công thức, đơn vị đo, và các hiện tượng thực tế đơn giản.
    ` : ""}
    ${type === "Tự luận" ? `
    - Thử thách khả năng vận dụng và tính toán.
    - Tập trung vào: Điền khuyết (điền vào chỗ trống), trả lời ngắn, nêu tên các bộ phận/quá trình, bài toán 1-2 phép tính, và đổi đơn vị.
    ` : ""}
    ${type === "Trắc nghiệm & Tự luận" ? `
    - Kết hợp 50% Trắc nghiệm (Nhận biết/Công thức) và 50% Tự luận (Điền khuyết/Bài tập ngắn) dựa trên tổng số ${count} câu.
    - Nếu ${count} là số lẻ, hãy ưu tiên Trắc nghiệm nhiều hơn Tự luận 1 câu.
    ` : ""}

    QUY TẮC TẠO ĐỀ:
    1. Truy xuất dữ liệu (Retrieve): Sử dụng nội dung chính xác trong tài liệu cô Trang đã upload dưới đây:
    ${context}
    
    2. Phân hóa: Câu hỏi phải có độ khó tăng dần.
    3. Tuyệt đối: Không lấy kiến thức ngoài tài liệu đã cung cấp. 
    4. Nếu tài liệu không có nội dung phù hợp cho khối lớp và chủ đề này, bạn PHẢI trả về JSON với trường "error": "Rất tiếc, tài liệu cô Trang chuẩn bị hiện chưa có nội dung này. Em vui lòng chọn chủ đề khác nhé!"

    Định dạng: Trình bày công thức bằng $...$ (LaTeX).
    CẢNH BÁO CHỮA LỖI JSON: Mọi lệnh LaTeX như \\cdot, \\rightarrow, \\frac... bắt buộc DÙNG 2 DẤU GẠCH CHÉO NGƯỢC (\\\\cdot, \\\\rightarrow, \\\\frac) trong đầu ra JSON để không gây lỗi parse.

    Trả lời DUY NHẤT theo định dạng JSON:
    {
      "quizzes": [
        {
          "question": "Câu hỏi...",
          "options": ["A...", "B...", "C...", "D..."], // TRỐNG [] nếu là câu Tự luận
          "answerIndex": 0, // -1 nếu là câu Tự luận
          "hint": "Gợi ý nhỏ nếu em trả lời sai lần 1 (cho trắc nghiệm) hoặc gợi ý hướng giải (cho tự luận)...",
          "difficulty": "Biết" | "Hiểu" | "Vận dụng",
          "explanation": "Giải thích chi tiết dựa trên tài liệu... Lời khuyên để em cải thiện: ...",
          "isEssay": boolean // true nếu là câu tự luận
        }
      ]
    }`;

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json"
        }
    });

    return safeJSONParse(response.text || "{}");
}

export async function generateFlashcards(topic: string, context: string, grade: string) {
    const prompt = `Bạn là hệ thống "Flashcard thông minh AI" thuộc dự án Gia sư AI KHTN của cô Trang. 
    Nhiệm vụ: Tạo bộ thẻ Flashcards học tập dựa trên:
    - Khối: ${grade}
    - Chủ đề: ${topic}
    - Ngữ cảnh: ${context}

    QUY TẮC:
    1. Tạo 5-8 thẻ Flashcards.
    2. Mỗi thẻ có: "front" (Câu hỏi/Thuật ngữ) và "back" (Câu trả lời/Định nghĩa ngắn gọn).
    3. Sử dụng LaTeX ($...$) cho MỌI công thức và ký hiệu khoa học.
    4. Định dạng: JSON duy nhất. BẮT BUỘC: thoát (escape) dấu \ trong các công thức (ví dụ: \\\\rightarrow, \\\\cdot) để không lỗi JSON parse.
    
    {
      "flashcards": [
        { "front": "...", "back": "..." }
      ]
    }`;

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
    });
    return safeJSONParse(response.text || "{}");
}

export async function generateMindmap(topic: string, context: string, grade: string) {
    const prompt = `Bạn là hệ thống "Mindmap AI" thuộc dự án Gia sư AI KHTN của cô Trang. 
    Nhiệm vụ: Phân tích và tạo cấu trúc Mindmap dựa trên:
    - Khối: ${grade}
    - Chủ đề: ${topic}
    - Ngữ cảnh: ${context}

    QUY TẮC:
    1. Bám sát nội dung tài liệu.
    2. Trình bày MỌI công thức và ký hiệu khoa học bằng LaTeX ($...$ hoặc $$...$$). 
    3. Trình bày dưới dạng JSON có các nodes (id, label, parentId) để vẽ sơ đồ.
    CẢNH BÁO CHỮA LỖI JSON: Mọi lệnh LaTeX như \\cdot, \\rightarrow, \\frac... bắt buộc DÙNG 2 DẤU GẠCH CHÉO NGƯỢC (\\\\cdot, \\\\rightarrow, \\\\frac) trong đầu ra JSON để không gây lỗi parse.
    4. Gốc (root) có parentId là null.
    
    {
      "mindmap": [
        { "id": "root", "label": "${topic}", "parentId": null },
        { "id": "n1", "label": "Ý chính 1", "parentId": "root" },
        { "id": "n1.1", "label": "Ý chi tiết 1.1", "parentId": "n1" }
      ]
    }`;

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
    });
    return safeJSONParse(response.text || "{}");
}

export async function analyzePerformance(topic: string, results: any[], context: string) {
    const prompt = `Bạn là cô Trang, giáo viên KHTN. Hãy phân tích kết quả làm bài của học sinh về chủ đề: ${topic}.
    
    Dữ liệu bài làm:
    ${JSON.stringify(results)}
    
    Ngữ cảnh tài liệu:
    ${context}

    YÊU CẦU:
    1. Chấm điểm theo thang điểm 10.
    2. Phân tích lỗ hổng: Chỉ ra chính xác học sinh đang yếu ở phần kiến thức nào dựa trên các câu trả lời sai.
    3. Lời khuyên từ cô Trang: Gợi ý các phần tài liệu cụ thể học sinh nên ôn tập lại.
    4. Giọng văn: Thân thiện, khích lệ, sư phạm.
    5. Sử dụng LaTeX ($...$) cho MỌI công thức và ký hiệu khoa học. Thoát dấu \ trong JSON (\\\\).

    Trả lời duy nhất định dạng JSON:
    {
      "score": 9.5,
      "analysis": "...",
      "advice": "..."
    }`;

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
    });
    return safeJSONParse(response.text || "{}");
}
export async function evaluateEssay(question: string, answer: string, image?: { data: string; mimeType: string }) {
  const prompt = `Bạn là cô Trang, một giáo viên KHTN chấm bài tự luận của học sinh.
  Câu hỏi: "${question}"
  Câu trả lời/Bài làm của học sinh: "${answer || "(Học sinh chỉ nộp ảnh đính kèm)"}"
  
  Nhiệm vụ của bạn:
  1. Phân tích bài làm của học sinh (nếu có hình ảnh, hãy đọc nội dung trong hình để chấm điểm).
  2. Đánh giá xem câu trả lời có chính xác hoặc đạt yêu cầu cơ bản (trên 5/10 điểm) hay không.
  3. Đưa ra nhận xét, giải thích và lời khuyên. Sử dụng LaTeX ($...$) cho MỌI công thức và ký hiệu khoa học. Thoát dấu \ trong JSON (\\\\).

  Trả về JSON có định dạng:
  {
    "isPassing": boolean, // true nếu đạt, false nếu chưa đạt
    "feedback": "...", // Lời nhận xét, giải thích chi tiết
    "score": number // Điểm từ 0 đến 10
  }`;

  const model = image ? "gemini-1.5-flash-8b" : "gemini-3-flash-preview";
  const parts: any[] = [{ text: prompt }];
  
  if (image) {
    parts.push({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
      model,
      contents: parts,
      config: { responseMimeType: "application/json" }
  });
  return safeJSONParse(response.text || "{}");
}
export async function generateComic(topic: string) {
  const prompt = `Hãy tạo một kịch bản truyện tranh 4 khung hình để giải thích đơn giản chủ đề KHTN: "${topic}".
  Mỗi khung hình cần:
  - Bối cảnh
  - Lời thoại nhân vật (Gia sư và Học sinh)
  - Mô tả hình ảnh (để AI hỗ trợ vẽ sau này)
  Trả về JSON:
  {
    "panels": [
      { "panel": 1, "description": "...", "dialogue": "..." }
    ]
  }`;

  const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
  });
  return safeJSONParse(response.text || "{}");
}

