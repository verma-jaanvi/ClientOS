import { env } from './env';
import { app } from './app';

app.listen(env.PORT, () => console.log(`ClientOS API listening on :${env.PORT}`));
