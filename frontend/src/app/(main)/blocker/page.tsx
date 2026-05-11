"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getBlockedDomains, addBlockedDomain, toggleBlockedDomain, deleteBlockedDomain } from "@/api/blocker";
import { Shield, Plus, Trash2, Globe, CheckCircle2, AlertCircle } from "lucide-react";

interface BlockedDomain {
  _id: string;
  domain: string;
  url: string;
  active: boolean;
  createdAt: string;
}

export default function BlockerPage() {
  const { fetchWithAuth } = useAuth();
  const [domains, setDomains] = useState<BlockedDomain[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDomains = async () => {
    setIsLoading(true);
    try {
      const data = await getBlockedDomains(fetchWithAuth);
      setDomains(data);
      setError(null);
    } catch (err: any) {
      setError("ไม่สามารถโหลดรายการบล็อกได้: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    
    setIsAdding(true);
    setError(null);
    try {
      await addBlockedDomain(fetchWithAuth, urlInput);
      setUrlInput("");
      await fetchDomains();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    try {
      // Optimistic update
      setDomains(domains.map(d => d._id === id ? { ...d, active: !currentActive } : d));
      await toggleBlockedDomain(fetchWithAuth, id, !currentActive);
    } catch (err: any) {
      // Revert on error
      await fetchDomains();
      setError("ไม่สามารถเปลี่ยนสถานะได้: " + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้?")) return;
    
    try {
      await deleteBlockedDomain(fetchWithAuth, id);
      setDomains(domains.filter(d => d._id !== id));
    } catch (err: any) {
      setError("ไม่สามารถลบรายการได้: " + err.message);
    }
  };

  return (
    <div className="p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* Header */}
        <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
            <Shield className="w-3 h-3" />
            System Control
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter">
            Web Filter<span className="text-indigo-600">.</span>
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-center max-w-sm mx-auto text-sm font-medium leading-relaxed">
            Block access to specific websites across your system by modifying local DNS rules.
          </p>
        </div>

        {/* Input Form */}
        <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xl shadow-zinc-200/20 dark:shadow-none animate-in zoom-in duration-500 delay-100">
          <form onSubmit={handleAddDomain} className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Globe className="h-5 w-5 text-zinc-400" />
              </div>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste URL to block (e.g., https://facebook.com)"
                className="block w-full pl-11 pr-4 py-3.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-white placeholder-zinc-400 transition-all"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isAdding || !urlInput.trim()}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-2xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95 whitespace-nowrap"
            >
              {isAdding ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  Add Block
                </>
              )}
            </button>
          </form>
          {error && (
            <div className="mt-4 flex items-center gap-2 text-sm text-rose-500 font-medium bg-rose-50 dark:bg-rose-500/10 p-3 rounded-xl">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        {/* Block List */}
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
          <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2 px-2">
            Blocked Domains
            <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full text-xs">
              {domains.length}
            </span>
          </h2>

          <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xl shadow-zinc-200/20 dark:shadow-none">
            {isLoading ? (
              <div className="p-10 flex justify-center">
                <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : domains.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                  <Shield className="w-8 h-8 text-zinc-400" />
                </div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">No active filters</h3>
                <p className="text-sm text-zinc-500 mt-1">Add a URL above to block access to it.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {domains.map((domain) => (
                  <div key={domain._id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${domain.active ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}>
                        {domain.active ? <Shield className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className={`text-base font-bold transition-colors ${domain.active ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-700'}`}>
                          {domain.domain}
                        </h3>
                        <p className="text-xs text-zinc-500 font-mono mt-0.5 truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                          {domain.url}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      {/* Toggle Switch */}
                      <button
                        onClick={() => handleToggle(domain._id, domain.active)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${domain.active ? 'bg-rose-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${domain.active ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      
                      <button
                        onClick={() => handleDelete(domain._id)}
                        className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
