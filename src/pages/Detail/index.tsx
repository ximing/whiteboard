import { useModel } from '@umijs/max';
import styles from './index.less';
import { Board } from '@/pages/Detail/components/board';

const HomePage: React.FC = () => {
  const { name } = useModel('global');
  return (
    <div className={styles.container}>
      <Board />
    </div>
  );
};

export default HomePage;
