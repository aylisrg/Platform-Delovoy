export type ParkingInfo = {
  totalSpots: number;
  guestSpots: number;
  tenantSpots: number;
  operatingHours: string;
  rules: string[];
  contacts: {
    phone?: string;
    email?: string;
  };
};
