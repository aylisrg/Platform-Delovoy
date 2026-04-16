export interface ProfileContacts {
  telegram: string | null;
  email: string | null;
  phone: string | null;
  vk: string | null;
}

export interface ProfileData {
  id: string;
  name: string | null;
  image: string | null;
  contacts: ProfileContacts;
}

export interface UpdateNameInput {
  name: string;
}

export interface AttachEmailRequestInput {
  email: string;
}

export interface AttachEmailConfirmInput {
  token: string;
}

export interface AttachPhoneRequestInput {
  phone: string;
}

export interface AttachPhoneConfirmInput {
  phone: string;
  code: string;
}

export type AttachEmailRequestResult = {
  sent: boolean;
};

export type AttachEmailConfirmResult = {
  email: string;
};

export type AttachPhoneRequestResult = {
  sent: boolean;
  phone: string; // masked
};

export type AttachPhoneConfirmResult = {
  phone: string;
};
