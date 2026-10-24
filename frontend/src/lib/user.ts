// Signed-in investigator shown in the header and greeting. There is no auth yet, so edit this to change it.
export const CURRENT_USER = {
  name: 'Abhinav Chitturi',
  role: 'Dispute investigator',
};

export const firstName = (name: string) => name.split(' ')[0];
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
