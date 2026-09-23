import { z } from "zod";

export const reviewInputSchema = z.object({
  productId: z.string().min(1),
  customerName: z.string().trim().min(1, "Enter your name.").max(80),
  rating: z.number().int().min(1, "Choose a rating.").max(5),
  comment: z.string().trim().min(1, "Say something about the product.").max(2000),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;
