
import React from 'react';

interface MarkdownViewProps {
  content: string;
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
  const renderLine = (line: string, index: number) => {
    const trimmed = line.trim();
    if (!trimmed && index > 0) return <div key={index} className="h-2" />;

    if (line.startsWith('# ')) return <h1 key={index} className="text-2xl font-bold border-b border-gray-100 pb-2 mb-4 text-indigo-800">{line.replace('# ', '')}</h1>;
    if (line.startsWith('## ')) return <h2 key={index} className="text-xl font-bold mt-5 mb-2 text-indigo-700">{line.replace('## ', '')}</h2>;
    if (line.startsWith('### ')) return <h3 key={index} className="text-lg font-semibold mt-3 mb-1 text-indigo-600">{line.replace('### ', '')}</h3>;
    if (line.startsWith('- ')) return <li key={index} className="ml-4 list-disc text-gray-700 mb-1 pl-1">{line.replace('- ', '')}</li>;
    if (line.startsWith('|')) return <div key={index} className="overflow-x-auto my-2"><pre className="text-[10px] bg-indigo-50/50 p-2 border border-indigo-100 rounded-lg font-mono text-indigo-900">{line}</pre></div>;
    
    // Simple bold transformation
    let processedText: React.ReactNode = line;
    if (line.includes('**')) {
      const parts = line.split('**');
      processedText = parts.map((p, i) => i % 2 === 1 ? <strong key={i} className="text-gray-900 font-bold">{p}</strong> : p);
    }

    if (line.trim() === '---') return <hr key={index} className="my-4 border-gray-100" />;
    
    return <p key={index} className="mb-1 text-sm leading-relaxed text-gray-700">{processedText}</p>;
  };

  const lines = content.split('\n');

  return (
    <div className="bg-white/50 rounded-xl p-1 font-sans">
      {lines.map((line, idx) => renderLine(line, idx))}
    </div>
  );
};

export default MarkdownView;
