import { trim } from '@/utils/format';
import { useModel } from '@umijs/max';
import styles from './index.less';

const HomePage: React.FC = () => {
  const { name } = useModel('global');
  return <div className={styles.container}>123</div>;
};

export default HomePage;
