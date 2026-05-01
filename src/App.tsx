/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Languages, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  RotateCcw, 
  Loader2,
  Trophy,
  History,
  Lightbulb,
  Search,
  ChevronRight,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Types
interface Segment {
  text: string;
  type: 'correct' | 'incorrect' | 'suggestion';
}

interface SentenceResult {
  original: string;
  student: string;
  bestVersion: string;
  score: number;
  segments: Segment[];
  retranslationSuggestion: string;
  explanation?: string;
}

interface EvaluationResult {
  totalScore: number;
  errorAnalysis: string;
  improvementAdvice: string;
}

export default function App() {
  const [originalText, setOriginalText] = useState('');
  const [translations, setTranslations] = useState<string[]>([]);
  const [sentenceResults, setSentenceResults] = useState<(SentenceResult | null)[]>([]);
  const [checkingIndices, setCheckingIndices] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<EvaluationResult | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Split text into sentences
  const sentences = useMemo(() => {
    if (!originalText.trim()) return [];
    return originalText
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 0);
  }, [originalText]);

  // Sync state with sentences count without losing user data
  React.useEffect(() => {
    setTranslations(prev => {
      if (prev.length === sentences.length) return prev;
      const next = [...prev];
      if (next.length < sentences.length) {
        return [...next, ...new Array(sentences.length - next.length).fill('')];
      }
      return next.slice(0, sentences.length);
    });
    setSentenceResults(prev => {
      if (prev.length === sentences.length) return prev;
      const next = [...prev];
      if (next.length < sentences.length) {
        return [...next, ...new Array(sentences.length - next.length).fill(null)];
      }
      return next.slice(0, sentences.length);
    });
    setSummary(null);
  }, [sentences.length]);

  const handleTranslationChange = (index: number, value: string) => {
    const newTranslations = [...translations];
    newTranslations[index] = value;
    setTranslations(newTranslations);
  };

  const handleCheckSentence = async (index: number) => {
    const translation = translations[index];
    if (!translation || !translation.trim()) return;
    
    setCheckingIndices(prev => new Set(prev).add(index));
    setError(null);

    try {
      const prompt = `
        Bạn là một giáo viên dạy dịch thuật Việt-Anh bản ngữ. Hãy chấm điểm câu dịch sau của học sinh.
        
        Câu gốc: "${sentences[index]}"
        Bản dịch của học sinh: "${translation}"
        
        NGUYÊN TẮC CHẤM ĐIỂM:
        1. Tôn trọng sự đa dạng: Nếu bản dịch của học sinh ĐÚNG và TỰ NHIÊN, hãy cho 10 điểm và KHÔNG cần đề xuất dịch lại (retranslationSuggestion giữ trống hoặc giống bản dịch gốc). Đừng bắt lỗi nếu đó chỉ là sở thích dùng từ khác biệt nhưng vẫn đúng.
        2. Chỉ sửa khi sai thực sự: Chỉ gán nhãn 'incorrect' cho lỗi ngữ pháp, sai nghĩa hoặc từ vựng hoàn toàn không phù hợp context.
        3. Gợi ý theo ngữ cảnh: Nếu phải đề xuất dịch lại, hãy chọn cách dịch tự nhiên nhất, chuyên nghiệp nhất phù hợp với ngữ cảnh của câu gốc.
        4. Chia bản dịch học sinh thành các segments và gán nhãn: 'correct' (đúng), 'incorrect' (sai/không tự nhiên).
        
        YÊU CẦU TRẢ VỀ JSON:
        - score: Thang điểm 10.
        - segments: Mảng các object {text, type: "correct" | "incorrect"}.
        - bestVersion: Bản dịch hoàn hảo nhất.
        - retranslationSuggestion: Một gợi ý dịch lại tốt hơn (CHỈ cung cấp nếu bản dịch học sinh chưa đạt 10 điểm hoặc có cách dùng từ hay hơn hẳn so với ngữ cảnh).
        - explanation: Giải thích ngắn gọn tại sao lỗi đó sai hoặc tại sao cách đề xuất lại hay hơn.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              original: { type: Type.STRING },
              student: { type: Type.STRING },
              bestVersion: { type: Type.STRING },
              score: { type: Type.NUMBER },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["correct", "incorrect", "suggestion"] }
                  }
                }
              },
              retranslationSuggestion: { type: Type.STRING },
              explanation: { type: Type.STRING }
            },
            required: ["original", "student", "bestVersion", "score", "segments", "retranslationSuggestion"]
          }
        }
      });

      const parsedResult = JSON.parse(response.text);
      const newResults = [...sentenceResults];
      newResults[index] = parsedResult;
      setSentenceResults(newResults);
    } catch (err: any) {
      console.error(err);
      setError("Không thể kiểm tra câu này. Vui lòng thử lại.");
    } finally {
      setCheckingIndices(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleFinishAndSummarize = async () => {
    if (sentenceResults.filter(r => r !== null).length === 0) return;
    
    setIsSummarizing(true);
    try {
      const checkedData = sentenceResults
        .map((r, i) => r ? `Q: ${r.original}\nA: ${r.student}\nScore: ${r.score}` : null)
        .filter(Boolean)
        .join('\n\n');

      const prompt = `
        Dựa trên kết quả dịch từng câu sau, hãy đưa ra bản tổng kết NGẮN GỌN và TRỰC QUAN cho học sinh.
        ${checkedData}
        
        YÊU CẦU TRẢ VỀ JSON:
        - totalScore: Trung bình cộng điểm số.
        - errorAnalysis: Phân tích theo đúng 3 tiêu chí dưới dạng gạch đầu dòng:
          1. **Từ vựng (Vocabulary)**: Nhận xét về cách dùng từ, sự phong phú hoặc lỗi từ vựng.
          2. **Ngữ pháp (Grammar)**: Các lỗi cấu trúc hoặc sự chính xác về thì, mạo từ.
          3. **Mạch lạc (Fluency)**: Độ trôi chảy, tự nhiên và sát ngữ cảnh của toàn đoạn.
        - improvementAdvice: Một lời khuyên cô đọng nhất.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              totalScore: { type: Type.NUMBER },
              errorAnalysis: { type: Type.STRING },
              improvementAdvice: { type: Type.STRING }
            }
          }
        }
      });

      setSummary(JSON.parse(response.text));
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleReset = () => {
    setOriginalText('');
    setTranslations([]);
    setSentenceResults([]);
    setSummary(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans overflow-hidden">
      {/* Navigation */}
      <nav className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <Languages className="w-6 h-6" />
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-800">
            Luyện Dịch <span className="text-blue-600">PRO</span>
          </span>
        </div>
        <div className="flex gap-4">
          <div className="hidden sm:flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full text-[10px] font-bold text-blue-600 uppercase tracking-wider">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            AI Assisted Learning
          </div>
          <button 
            onClick={handleReset}
            className="text-sm font-medium text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-4 h-4" />
            Làm mới
          </button>
        </div>
      </nav>

      <main className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN: Workspace */}
        <section className="w-1/2 flex flex-col border-r border-gray-200 bg-white">
          {/* Input Header */}
          <div className="p-6 pb-0">
             <textarea 
               value={originalText}
               onChange={(e) => setOriginalText(e.target.value)}
               placeholder="Dán đoạn văn bạn muốn luyện dịch vào đây..."
               className="w-full h-32 p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-gray-700 leading-relaxed focus:outline-none focus:border-blue-100 focus:bg-white transition-all resize-none font-serif text-lg"
             />
          </div>

          {/* Translation Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

            
            {sentences.length > 0 ? (
              <div className="space-y-12 pb-24">
                {sentences.map((sentence, index) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={index} 
                    className="relative group p-4 rounded-3xl border-2 border-transparent hover:border-gray-50 transition-colors"
                  >
                    <div className="flex gap-4 items-start mb-4">
                      <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-400 shrink-0 mt-1">
                        {index + 1}
                      </span>
                      <p className="text-gray-500 font-serif italic text-lg leading-relaxed">{sentence}</p>
                    </div>

                    <div className="relative">
                      <textarea
                        value={translations[index] || ''}
                        onChange={(e) => handleTranslationChange(index, e.target.value)}
                        placeholder="Gõ bản dịch vào đây..."
                        rows={3}
                        className={`w-full p-4 bg-white border-2 rounded-2xl focus:outline-none transition-all resize-none text-base shadow-sm ${
                          sentenceResults[index] 
                          ? 'border-blue-50 py-3 pr-24' 
                          : 'border-gray-100 focus:border-blue-500 pr-24'
                        }`}
                      />
                      <button
                        disabled={checkingIndices.has(index) || !(translations[index] || '').trim()}
                        onClick={() => handleCheckSentence(index)}
                        className={`absolute right-3 bottom-3 p-3 rounded-xl transition-all ${
                          checkingIndices.has(index)
                          ? 'bg-gray-100 text-gray-400'
                          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100 active:scale-95'
                        }`}
                        title="Kiểm tra câu này"
                      >
                        {checkingIndices.has(index) ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    {/* Individual Feedback Overlay/Underlay */}
                    <AnimatePresence>
                      {sentenceResults[index] && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-4 bg-blue-50/50 rounded-2xl border border-blue-100 overflow-hidden"
                        >
                          <div className="p-4 space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded uppercase tracking-wider">AI Score: {sentenceResults[index]?.score}/10</span>
                              <button 
                                onClick={() => {
                                  const nr = [...sentenceResults];
                                  nr[index] = null;
                                  setSentenceResults(nr);
                                }}
                                className="text-[10px] text-gray-400 hover:text-blue-600 font-bold"
                              >
                                Sửa lời giải
                              </button>
                            </div>
                            
                            <div className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
                              {sentenceResults[index]?.segments.map((seg, sIdx) => (
                                <span 
                                  key={sIdx}
                                  className={`${
                                    seg.type === 'correct' ? 'text-green-700 underline decoration-green-300 underline-offset-4' : 
                                    'text-red-500 bg-red-50 px-1 rounded'
                                  } font-medium`}
                                >
                                  {seg.text}
                                </span>
                              ))}
                            </div>

                            {sentenceResults[index]?.explanation && (
                              <p className="text-[11px] text-gray-500 font-medium bg-gray-50 p-2 rounded-lg border border-gray-100">
                                <span className="font-bold text-blue-600">Lưu ý:</span> {sentenceResults[index]?.explanation}
                              </p>
                            )}

                            {sentenceResults[index]?.retranslationSuggestion && 
                             sentenceResults[index]?.score! < 10 && (
                              <div className="bg-white/80 rounded-xl p-3 border border-blue-100/50 shadow-sm">
                                <p className="text-[10px] font-bold text-blue-600 uppercase mb-1 flex items-center gap-1">
                                  <Lightbulb className="w-3 h-3" />
                                  Đề xuất sát ngữ cảnh hơn:
                                </p>
                                <p className="text-sm text-gray-800 italic decoration-blue-200 underline-offset-2">
                                  "{sentenceResults[index]?.retranslationSuggestion}"
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-gray-300">
                <Search className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm font-medium italic">Chưa có nội dung bài tập</p>
              </div>
            )}
          </div>
          
          {/* Summary Trigger */}
          {sentences.length > 0 && (
            <div className="p-6 bg-gray-50 border-t border-gray-100">
              <button 
                onClick={handleFinishAndSummarize}
                disabled={isSummarizing || sentenceResults.filter(r => r !== null).length === 0}
                className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                  isSummarizing || sentenceResults.filter(r => r !== null).length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-gray-800 shadow-xl shadow-gray-200 active:scale-[0.98]'
                }`}
              >
                {isSummarizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trophy className="w-5 h-5" />}
                XEM TỔNG KẾT BÀI DỊCH
              </button>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: Evaluation & Analysis */}
        <section className="w-1/2 bg-gray-50 flex flex-col p-8 overflow-y-auto custom-scrollbar border-l border-gray-100">
          <AnimatePresence mode="wait">
            {!summary ? (
              <motion.div 
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-center p-12"
              >
                <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-lg border border-gray-100 mb-8 transform -rotate-6">
                  <CheckCircle2 className="w-12 h-12 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-3 tracking-tight">Kết quả chi tiết & Tổng quát</h3>
                <p className="text-gray-400 text-sm max-w-xs leading-relaxed font-medium">
                  Hoàn thành dịch và <span className="text-blue-600 font-bold">Kiểm tra từng câu</span> ở bên trái, sau đó nhấn nút "Xem tổng kết" để nhận phân tích chuyên sâu từ AI.
                </p>
                <div className="mt-12 flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-200"></div>
                  <div className="w-2 h-2 rounded-full bg-blue-300"></div>
                  <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="summary"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-10"
              >
                {/* Score Dashboard */}
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Detailed Report</h2>
                    <p className="text-3xl font-black text-gray-800 tracking-tighter">Báo cáo năng lực</p>
                  </div>
                  <div className="text-right">
                    <div className="text-6xl font-black text-blue-600 leading-none">
                      {summary.totalScore}<span className="text-xl text-gray-300 font-medium">/10</span>
                    </div>
                    <div className="inline-block mt-2 text-[10px] font-black text-white bg-blue-500 px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-blue-100">
                      Intermediate Level
                    </div>
                  </div>
                </div>

                {/* Analysis Blocks */}
                <div className="grid grid-cols-1 gap-6">
                  <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full -mr-12 -mt-12 group-hover:bg-blue-100 transition-colors"></div>
                    <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 mb-6">
                      <History className="w-4 h-4" /> 
                      Tổng quan 3 tiêu chuẩn
                    </h4>
                    <div className="prose prose-sm prose-slate max-w-none text-gray-600 leading-relaxed font-sans">
                       <ReactMarkdown>{summary.errorAnalysis}</ReactMarkdown>
                    </div>
                  </div>

                  <div className="bg-[#1A1A1A] p-8 rounded-3xl shadow-xl shadow-gray-200 text-white relative overflow-hidden">
                    <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 mb-4">
                      <Lightbulb className="w-4 h-4" /> 
                      Advice
                    </h4>
                    <div className="text-sm opacity-90 leading-relaxed font-medium italic border-l-2 border-blue-500 pl-4">
                      <ReactMarkdown>{summary.improvementAdvice}</ReactMarkdown>
                    </div>
                  </div>
                </div>

                {/* Individual Review List Mini */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tóm tắt từng câu</h4>
                  <div className="space-y-3">
                    {sentenceResults.map((r, i) => r && (
                      <div key={i} className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-gray-100 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                          <span className="font-bold text-gray-700">Câu {i + 1}</span>
                        </div>
                        <span className={`font-black ${r.score >= 8 ? 'text-green-500' : 'text-orange-500'}`}>{r.score}/10</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3B82F6;
        }
      `}</style>
    </div>
  );
}
