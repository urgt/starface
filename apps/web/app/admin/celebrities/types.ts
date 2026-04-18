export type CelebrityPhotoMini = {
  id: string;
  photoPath: string;
  isPrimary: boolean;
  faceQuality: string | null;
};

export type CelebrityRow = {
  id: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  descriptionUz: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  wikidataId: string | null;
  active: boolean | null;
  createdAt: string | null;
  photos: CelebrityPhotoMini[];
  primaryPhotoPath: string | null;
  photoCount: number;
};

export type CelebrityDetail = {
  id: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  descriptionUz: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  wikidataId: string | null;
  active: boolean;
  createdAt: string | null;
  photos: Array<{
    id: string;
    photoUrl: string;
    photoPath: string;
    isPrimary: boolean;
    faceQuality: string | null;
    detScore: number | null;
  }>;
};
