"use server";

import { getStaff } from "@/lib/staff";
import { unreadConversations } from "@/lib/messages";

export async function unreadCount() {
  const { supabase, userId, staff } = await getStaff();
  if (!staff) return 0;
  return unreadConversations(supabase, userId);
}
