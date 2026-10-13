import { Router } from 'express';
import { listDomainUsers } from '../gam/users.js';
import { h } from '../util.js';

export const usersRouter = Router();

usersRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(await listDomainUsers());
  }),
);
