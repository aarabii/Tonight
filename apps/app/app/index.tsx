import { StyleSheet, Text, View } from 'react-native';
import { MOODS } from '@tonight/shared';

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tonight</Text>
      <Text style={styles.subtitle}>
        Story-first movie recommendations ({MOODS.length} canonical moods ready)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B090E',
    padding: 24,
  },
  title: {
    color: '#F4EFE6',
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#A79F94',
    fontSize: 15,
    textAlign: 'center',
  },
});
