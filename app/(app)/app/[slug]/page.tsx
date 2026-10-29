"use client";
import { useParams } from "next/navigation";
import { bySlug } from "@/lib/doctypes";
import { DocList } from "@/components/doc-list";

export default function ListPage() {
  const { slug } = useParams<{ slug: string }>();
  const dt = bySlug[slug];
  if (!dt) return <div className="p-10 text-zinc-500">Halaman tidak ditemukan</div>;
  return <DocList key={slug} dt={dt} />;
}
