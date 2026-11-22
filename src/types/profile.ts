export type ExperienceLevel = "beginner" | "intermediate" | "professional" | "no_experience";

export interface DakhlProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  governorate: string | null;
  city: string | null;
  bio: string | null;
  experience_level: ExperienceLevel | null;
  profile_completed: boolean;
  skills: string[];
  interests: string[];
}
