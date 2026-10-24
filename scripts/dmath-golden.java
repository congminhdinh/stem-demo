// Golden table for src/core/world/dmath.ts (N18 R3.1, D-R12, ADR 0001 §4.6).
//
// dmath.ts ports fdlibm 5.3's sin, cos and atan2 so the robot world gets the same bits on every JS engine.
// Java's StrictMath.sin/cos/atan2 are specified to return exactly what fdlibm 5.3 returns, which makes them
// a reference that owes nothing to the TypeScript port. Run once with any JDK 11+ (source-file mode) and
// commit the output:
//
//   java scripts/dmath-golden.java > src/core/world/dmath.golden.ts
//
// The inputs are the edge cases of each fdlibm branch (thresholds on the high word, multiples of pi/2 that
// need the 2nd/3rd reduction step, the Payne-Hanek path for huge arguments, infinities, NaN, signed zeros,
// subnormals) plus seeded pseudo-random values, so the table is the same every time it is generated.

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.SplittableRandom;

public class DmathGolden {
    static final long SEED = 20261025L;

    /** An input, exactly as it is. */
    static String bits(double v) {
        return String.format("%016x", Double.doubleToRawLongBits(v));
    }

    /** A result; any NaN is "nan", since fdlibm leaves the NaN payload to the CPU. */
    static String hex(double v) {
        return Double.isNaN(v) ? "nan" : bits(v);
    }

    static double fromWords(long hi, long lo) {
        return Double.longBitsToDouble((hi << 32) | (lo & 0xffffffffL));
    }

    /** Values on both sides of a branch threshold given as fdlibm's high word, both signs. */
    static void aroundHighWord(LinkedHashSet<Long> out, long hi) {
        double[] values = {
            fromWords(hi - 1, 0xffffffffL), fromWords(hi, 0), fromWords(hi, 1), fromWords(hi, 0xffffffffL), fromWords(hi + 1, 0),
        };
        for (double v : values) {
            out.add(Double.doubleToRawLongBits(v));
            out.add(Double.doubleToRawLongBits(-v));
        }
    }

    static void add(LinkedHashSet<Long> out, double v) {
        out.add(Double.doubleToRawLongBits(v));
    }

    /** A double with a random mantissa and sign and an exponent field drawn from [minExp, maxExp]. */
    static double logUniform(SplittableRandom random, int minExp, int maxExp) {
        long exponent = minExp + random.nextInt(maxExp - minExp + 1);
        long mantissa = random.nextLong() & 0xfffffffffffffL;
        long sign = random.nextBoolean() ? 1L << 63 : 0;
        return Double.longBitsToDouble(sign | (exponent << 52) | mantissa);
    }

    static List<Double> sinCosInputs() {
        LinkedHashSet<Long> out = new LinkedHashSet<>();
        double[] specials = {
            0.0, -0.0, Double.MIN_VALUE, -Double.MIN_VALUE, Double.MIN_NORMAL, -Double.MIN_NORMAL, Double.MAX_VALUE,
            -Double.MAX_VALUE, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NaN, 1.0, -1.0, 0.5, 2.0,
            Math.PI, -Math.PI, 2 * Math.PI, Math.PI / 4, Math.PI / 3, Math.PI / 6, 1e-10, 1e-300,
        };
        for (double v : specials) add(out, v);
        // Branches: |x| < 2^-27 (kernels), 0.3 and 0.78125 (k_cos), pi/4 (no reduction), 3pi/4 (n = +-1),
        // 2^19 * pi/2 (medium reduction), and the start of Inf/NaN.
        long[] thresholds = { 0x3e400000L, 0x3fd33333L, 0x3fe90000L, 0x3fe921fbL, 0x3ff921fbL, 0x4002d97cL, 0x413921fbL, 0x7fefffffL };
        for (long hi : thresholds) aroundHighWord(out, hi);
        // Multiples of pi/2: the reduction cancels most bits (2nd and 3rd steps), n < 32 uses npio2_hw.
        for (int n = 1; n <= 40; n++) {
            double v = n * (Math.PI / 2);
            add(out, v);
            add(out, Math.nextUp(v));
            add(out, -Math.nextDown(v));
        }
        for (int k = 5; k <= 19; k++) add(out, Math.scalb(1.0, k) * (Math.PI / 2));
        // Huge arguments: the Payne-Hanek path (__kernel_rem_pio2), including the classic worst case for
        // argument reduction, 6381956970095103 * 2^797.
        double[] huge = { 1e6, 1e7, 1e9, 1e15, 1e16, 1e22, 1e100, 1e200, 1e300, Math.scalb(1.0, 30), Math.scalb(1.0, 31),
            Math.scalb(1.0, 52), Math.scalb(1.0, 53), Math.scalb(1.0, 1000), Math.scalb(1.0, 1023),
            Math.scalb(6381956970095103.0, 797), -Math.scalb(6381956970095103.0, 797) };
        for (double v : huge) add(out, v);
        // Whole degrees the robot lab uses for yaw and sensor rays, in radians.
        for (int deg = -360; deg <= 360; deg += 15) add(out, deg * (Math.PI / 180));
        SplittableRandom random = new SplittableRandom(SEED);
        for (int i = 0; i < 100; i++) add(out, (random.nextDouble() * 2 - 1) * 2 * Math.PI);
        for (int i = 0; i < 50; i++) add(out, (random.nextDouble() * 2 - 1) * 1000);
        for (int i = 0; i < 50; i++) add(out, logUniform(random, 0x3c0, 0x7fe));
        List<Double> inputs = new ArrayList<>();
        for (long bits : out) inputs.add(Double.longBitsToDouble(bits));
        return inputs;
    }

    static List<double[]> atan2Inputs() {
        List<double[]> pairs = new ArrayList<>();
        double[] specials = {
            0.0, -0.0, Double.MIN_VALUE, -Double.MIN_VALUE, 1.0, -1.0, 0.5, -2.5, Double.MAX_VALUE, -Double.MAX_VALUE,
            Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NaN,
        };
        for (double y : specials) for (double x : specials) pairs.add(new double[] { y, x });
        // x = 1 goes straight to atan(y): every interval of fdlibm's atan.
        LinkedHashSet<Long> atanArgs = new LinkedHashSet<>();
        long[] atanThresholds = { 0x3e200000L, 0x3fdc0000L, 0x3fe60000L, 0x3ff30000L, 0x40038000L, 0x44100000L };
        for (long hi : atanThresholds) aroundHighWord(atanArgs, hi);
        for (long bits : atanArgs) pairs.add(new double[] { Double.longBitsToDouble(bits), 1.0 });
        // |y/x| beyond 2^60 either way, in every quadrant.
        double big = Math.scalb(1.0, 62), small = Math.scalb(1.0, -62);
        double[][] ratios = { { big, 1 }, { -big, 1 }, { big, -1 }, { -big, -1 }, { small, 1 }, { -small, 1 }, { small, -1 },
            { -small, -1 }, { 1e30, 1e-40 }, { 1e-40, -1e30 }, { -1e-40, -1e30 } };
        for (double[] p : ratios) pairs.add(p);
        // Unit vectors every 15 degrees (headings, sensor rays).
        for (int deg = -180; deg < 180; deg += 15) {
            double a = deg * (Math.PI / 180);
            pairs.add(new double[] { StrictMath.sin(a), StrictMath.cos(a) });
        }
        SplittableRandom random = new SplittableRandom(SEED + 1);
        for (int i = 0; i < 150; i++) pairs.add(new double[] { (random.nextDouble() * 2 - 1) * 10, (random.nextDouble() * 2 - 1) * 10 });
        for (int i = 0; i < 50; i++) pairs.add(new double[] { logUniform(random, 0x380, 0x440), logUniform(random, 0x380, 0x440) });
        return pairs;
    }

    public static void main(String[] args) {
        StringBuilder out = new StringBuilder();
        out.append("// GENERATED by scripts/dmath-golden.java; do not edit by hand. Regenerate with:\n");
        out.append("//   java scripts/dmath-golden.java > src/core/world/dmath.golden.ts\n");
        out.append("// Reference: ").append(System.getProperty("java.vm.name")).append(' ').append(System.getProperty("java.version"));
        out.append(", StrictMath (specified to return fdlibm 5.3's results). Values are IEEE-754 bit patterns in hex; a \"nan\" result is any NaN.\n\n");
        out.append("/** [x, sin(x), cos(x)] */\n");
        out.append("export const SIN_COS_GOLDEN: readonly (readonly [string, string, string])[] = [\n");
        for (double x : sinCosInputs()) {
            out.append("  ['").append(bits(x)).append("', '").append(hex(StrictMath.sin(x))).append("', '").append(hex(StrictMath.cos(x))).append("'],\n");
        }
        out.append("];\n\n/** [y, x, atan2(y, x)] */\n");
        out.append("export const ATAN2_GOLDEN: readonly (readonly [string, string, string])[] = [\n");
        for (double[] p : atan2Inputs()) {
            out.append("  ['").append(bits(p[0])).append("', '").append(bits(p[1])).append("', '").append(hex(StrictMath.atan2(p[0], p[1]))).append("'],\n");
        }
        out.append("];\n");
        System.out.print(out);
    }
}
