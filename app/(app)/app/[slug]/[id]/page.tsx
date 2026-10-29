"use client";
import { useParams } from "next/navigation";
import { bySlug } from "@/lib/doctypes";
import { DocForm } from "@/components/doc-form";

export default function FormPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const dt = bySlug[slug];
  if (!dt) return <div className="p-10 text-zinc-500">Halaman tidak ditemukan</div>;
  return <DocForm key={`${slug}/${id}`} dt={dt} id={decodeURIComponent(id)} />;
}
