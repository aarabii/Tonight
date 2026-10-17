export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      favourite_people: {
        Row: {
          added_at: string
          person_id: number
          user_id: string
        }
        Insert: {
          added_at?: string
          person_id: number
          user_id: string
        }
        Update: {
          added_at?: string
          person_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favourite_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favourite_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "favourite_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      moods: {
        Row: {
          description: string
          embedding: unknown
          id: string
          label: string
          sort: number
        }
        Insert: {
          description: string
          embedding: unknown
          id: string
          label: string
          sort: number
        }
        Update: {
          description?: string
          embedding?: unknown
          id?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      movie_embeddings: {
        Row: {
          chunks: number
          embedding: unknown
          model: string
          movie_id: number
          updated_at: string
        }
        Insert: {
          chunks: number
          embedding: unknown
          model?: string
          movie_id: number
          updated_at?: string
        }
        Update: {
          chunks?: number
          embedding?: unknown
          model?: string
          movie_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movie_embeddings_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: true
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
        ]
      }
      movie_people: {
        Row: {
          billing: number | null
          movie_id: number
          person_id: number
          role: string
        }
        Insert: {
          billing?: number | null
          movie_id: number
          person_id: number
          role: string
        }
        Update: {
          billing?: number | null
          movie_id?: number
          person_id?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "movie_people_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movie_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      movies: {
        Row: {
          countries: string[]
          enwiki_title: string | null
          genres: string[]
          has_story: boolean
          id: number
          imdb_id: string | null
          imdb_rating: number | null
          imdb_votes: number | null
          languages: string[]
          original_title: string | null
          plot_hash: string | null
          popularity_pct: number | null
          runtime_min: number | null
          series_qid: string | null
          settings: string[]
          sitelinks: number | null
          source: string
          subjects: string[]
          title: string | null
          tmdb_id: number | null
          updated_at: string
          wikidata_qid: string | null
          year: number | null
        }
        Insert: {
          countries?: string[]
          enwiki_title?: string | null
          genres?: string[]
          has_story?: boolean
          id?: never
          imdb_id?: string | null
          imdb_rating?: number | null
          imdb_votes?: number | null
          languages?: string[]
          original_title?: string | null
          plot_hash?: string | null
          popularity_pct?: number | null
          runtime_min?: number | null
          series_qid?: string | null
          settings?: string[]
          sitelinks?: number | null
          source?: string
          subjects?: string[]
          title?: string | null
          tmdb_id?: number | null
          updated_at?: string
          wikidata_qid?: string | null
          year?: number | null
        }
        Update: {
          countries?: string[]
          enwiki_title?: string | null
          genres?: string[]
          has_story?: boolean
          id?: never
          imdb_id?: string | null
          imdb_rating?: number | null
          imdb_votes?: number | null
          languages?: string[]
          original_title?: string | null
          plot_hash?: string | null
          popularity_pct?: number | null
          runtime_min?: number | null
          series_qid?: string | null
          settings?: string[]
          sitelinks?: number | null
          source?: string
          subjects?: string[]
          title?: string | null
          tmdb_id?: number | null
          updated_at?: string
          wikidata_qid?: string | null
          year?: number | null
        }
        Relationships: []
      }
      people: {
        Row: {
          id: number
          name: string
          tmdb_person_id: number | null
          wikidata_qid: string | null
        }
        Insert: {
          id?: never
          name: string
          tmdb_person_id?: number | null
          wikidata_qid?: string | null
        }
        Update: {
          id?: never
          name?: string
          tmdb_person_id?: number | null
          wikidata_qid?: string | null
        }
        Relationships: []
      }
      pipeline_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          discovery_dial: number
          display_name: string | null
          onboarded_at: string | null
          region: string
          user_id: string
          username: string
          visibility: Database["public"]["Enums"]["visibility"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          discovery_dial?: number
          display_name?: string | null
          onboarded_at?: string | null
          region?: string
          user_id: string
          username: string
          visibility?: Database["public"]["Enums"]["visibility"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          discovery_dial?: number
          display_name?: string | null
          onboarded_at?: string | null
          region?: string
          user_id?: string
          username?: string
          visibility?: Database["public"]["Enums"]["visibility"]
        }
        Relationships: []
      }
      rec_cache: {
        Row: {
          created_at: string
          key: string
          payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          payload: Json
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rec_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      rec_feedback: {
        Row: {
          created_at: string
          kind: string
          movie_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          movie_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          movie_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_feedback_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rec_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      tmdb_cache: {
        Row: {
          details: Json
          details_fetched_at: string
          providers: Json | null
          providers_fetched_at: string | null
          tmdb_id: number
        }
        Insert: {
          details: Json
          details_fetched_at?: string
          providers?: Json | null
          providers_fetched_at?: string | null
          tmdb_id: number
        }
        Update: {
          details?: Json
          details_fetched_at?: string
          providers?: Json | null
          providers_fetched_at?: string | null
          tmdb_id?: number
        }
        Relationships: []
      }
      tmdb_person_cache: {
        Row: {
          details: Json
          fetched_at: string
          tmdb_person_id: number
        }
        Insert: {
          details: Json
          fetched_at?: string
          tmdb_person_id: number
        }
        Update: {
          details?: Json
          fetched_at?: string
          tmdb_person_id?: number
        }
        Relationships: []
      }
      tmdb_search_cache: {
        Row: {
          fetched_at: string
          payload: Json
          query_key: string
        }
        Insert: {
          fetched_at?: string
          payload: Json
          query_key: string
        }
        Update: {
          fetched_at?: string
          payload?: Json
          query_key?: string
        }
        Relationships: []
      }
      user_movies: {
        Row: {
          added_at: string
          is_favourite: boolean
          movie_id: number
          note: string | null
          reaction: Database["public"]["Enums"]["reaction"] | null
          source: string
          status: Database["public"]["Enums"]["track_status"]
          updated_at: string
          user_id: string
          watched_on: string | null
        }
        Insert: {
          added_at?: string
          is_favourite?: boolean
          movie_id: number
          note?: string | null
          reaction?: Database["public"]["Enums"]["reaction"] | null
          source?: string
          status: Database["public"]["Enums"]["track_status"]
          updated_at?: string
          user_id: string
          watched_on?: string | null
        }
        Update: {
          added_at?: string
          is_favourite?: boolean
          movie_id?: number
          note?: string | null
          reaction?: Database["public"]["Enums"]["reaction"] | null
          source?: string
          status?: Database["public"]["Enums"]["track_status"]
          updated_at?: string
          user_id?: string
          watched_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_movies_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_movies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_movies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_providers: {
        Row: {
          provider_id: number
          user_id: string
        }
        Insert: {
          provider_id: number
          user_id: string
        }
        Update: {
          provider_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_view_profile: { Args: { target: string }; Returns: boolean }
      candidates_near_vector: {
        Args: { k?: number; q: unknown }
        Returns: {
          movie_id: number
          sim: number
        }[]
      }
      is_mutual: { Args: { a: string; b: string }; Returns: boolean }
      movies_by_people: {
        Args: { max_n?: number; person_ids: number[] }
        Returns: {
          movie_id: number
          person_id: number
        }[]
      }
      purge_expired_caches: { Args: never; Returns: undefined }
      rec_candidates: {
        Args: { anchor_ids: number[]; per_anchor?: number }
        Returns: {
          anchor_id: number
          movie_id: number
          sim: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sim_matrix: {
        Args: { anchor_ids: number[]; candidate_ids: number[] }
        Returns: {
          anchor_id: number
          movie_id: number
          sim: number
        }[]
      }
      similar_movies: {
        Args: { k?: number; mid: number }
        Returns: {
          movie_id: number
          sim: number
        }[]
      }
      user_anchors: {
        Args: { max_n?: number; uid: string }
        Returns: {
          has_story: boolean
          movie_id: number
          weight: number
        }[]
      }
    }
    Enums: {
      reaction: "loved" | "liked" | "meh" | "disliked"
      track_status: "watchlist" | "watched"
      visibility: "public" | "friends" | "private"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      reaction: ["loved", "liked", "meh", "disliked"],
      track_status: ["watchlist", "watched"],
      visibility: ["public", "friends", "private"],
    },
  },
} as const
