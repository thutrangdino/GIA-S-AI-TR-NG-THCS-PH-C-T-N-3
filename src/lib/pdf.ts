import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export async function exportToPDF(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false
  });
  
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const imgProps = pdf.getImageProperties(imgData);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  
  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${filename}.pdf`);
}

export function generateSummaryPDF(topic: string, summary: string, questions: any[]) {
    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(22);
    doc.setTextColor(13, 148, 136); // Teal
    doc.text(`TÓM TẮT CHỦ ĐỀ: ${topic.toUpperCase()}`, 20, 30);
    
    // Summary
    doc.setFontSize(12);
    doc.setTextColor(51, 65, 85); // Slate
    const splitSummary = doc.splitTextToSize(summary, 170);
    doc.text(splitSummary, 20, 50);
    
    // Questions section
    let y = 100;
    doc.setFontSize(16);
    doc.setTextColor(13, 148, 136);
    doc.text("CÂU HỎI ÔN TẬP", 20, y);
    y += 15;
    
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    questions.forEach((q, i) => {
        if (y > 270) {
            doc.addPage();
            y = 30;
        }
        const splitQ = doc.splitTextToSize(`${i+1}. ${q.question}`, 170);
        doc.text(splitQ, 20, y);
        y += splitQ.length * 7;
    });
    
    doc.save(`tai-lieu-on-tap-${topic}.pdf`);
}
